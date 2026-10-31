import { Logger } from '@nestjs/common'
import sharp from 'sharp'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { writeFile } from 'fs/promises'
import { thumbnailJobSchema, type ThumbnailJob } from './job-schemas'
import { patchStatusFailed, runAssetFileJob } from './asset-file-job'
import type { ProcessorDeps, ProcessorSpec } from './processor-spec'
import type { Asset, FileRecord } from '@photox/shared-types'
import { runFfmpeg } from './ffmpeg'

const STANDARD_SIZES: Record<ThumbnailJob['size'], [number, number]> = {
  sm: [150, 150],
  md: [300, 300],
  lg: [600, 600],
  xl: [1920, 1920],
}

// ponytail: fit: 'inside' preserves the source aspect ratio (landscape/portrait); 'cover' was cropping to a square, which broke the downstream masonry grid.
const RESIZE_OPTIONS: sharp.ResizeOptions = { fit: 'inside', withoutEnlargement: true }

// video thumbs need the metadata job's orientation/duration; metadata runs on a sibling queue with
// no ordering guarantee, so a pending video job re-enqueues itself with a fixed delay instead of
// polling in-process — bounded so a permanently failed metadata job still falls through to defaults
const METADATA_WAIT_DELAY_MS = 1000
const MAX_METADATA_WAITS = 5

export function thumbnailProcessor({
  bullMq,
  core,
  storage,
}: Pick<ProcessorDeps, 'bullMq' | 'core' | 'storage'>): ProcessorSpec<ThumbnailJob> {
  const logger = new Logger('ThumbnailProcessor')

  async function generateThumbnail(
    record: FileRecord,
    asset: Asset,
    size: ThumbnailJob['size'],
    userId: string,
    sourcePath: string,
    sig?: string,
  ): Promise<void> {
    const mimeType = record.mimeType

    if (mimeType?.startsWith('video/')) {
      const rawDuration = asset.durationSeconds === null ? null : Number(asset.durationSeconds)
      const durationSeconds =
        rawDuration === null || !Number.isFinite(rawDuration) ? 0 : rawDuration
      const degrees = asset.orientation === null ? 0 : ((asset.orientation % 360) + 360) % 360

      const seekSec =
        durationSeconds > 0
          ? Math.min(Math.max(0, durationSeconds * 0.25), Math.max(0, durationSeconds - 0.1))
          : 0

      const frameBuffer = await runFfmpeg([
        '-y',
        '-noautorotate',
        '-ss',
        String(seekSec),
        '-i',
        sourcePath,
        '-vframes',
        '1',
        '-f',
        'image2pipe',
        '-',
      ])

      const { data: thumbBuffer, info } = await encodeWebp(frameBuffer, size, degrees)

      await storeThumbnail(userId, asset.id, size, thumbBuffer, info, sig)

      return
    }

    // ponytail: stock sharp prebuilds have no HEIC (HEVC) decoder — route iPhone photos
    // through ffmpeg (has libde265), upgrade to a libheif-capable sharp build if it lands
    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      const frameBuffer = await runFfmpeg([
        '-y',
        '-i',
        sourcePath,
        '-vframes',
        '1',
        '-f',
        'image2pipe',
        '-',
      ])
      const { data: thumbBuffer, info } = await encodeWebp(frameBuffer, size)
      await storeThumbnail(userId, asset.id, size, thumbBuffer, info, sig)
      return
    }

    // photo sources are auto-oriented from their EXIF Orientation tag — phone JPEGs store
    // sideways pixels plus a rotation flag, so skipping this renders them sideways
    const { data: thumbBuffer, info } = await encodeWebp(sourcePath, size, 'exif')

    await storeThumbnail(userId, asset.id, size, thumbBuffer, info, sig)
  }

  // 'exif' = sharp auto-orient from the file's Orientation tag; explicit degrees = video rotation
  // (the frame is captured with -noautorotate, so the asset's orientation is the only source)
  async function encodeWebp(
    source: Buffer | string,
    size: ThumbnailJob['size'],
    rotation: number | 'exif' = 0,
  ) {
    const [width, height] = STANDARD_SIZES[size]
    let pipeline = sharp(source)
    if (rotation === 'exif') pipeline = pipeline.rotate()
    else if (rotation !== 0) pipeline = pipeline.rotate(rotation)
    return pipeline
      .resize(width, height, RESIZE_OPTIONS)
      .webp({ quality: size === 'xl' ? 85 : 80 })
      .toBuffer({ resolveWithObject: true })
  }

  async function storeThumbnail(
    userId: string,
    assetId: string,
    size: string,
    thumbBuffer: Buffer,
    info: { width: number; height: number },
    sig?: string,
  ): Promise<void> {
    const checksum = createHash('sha256').update(thumbBuffer).digest('hex')
    const fileId = randomUUID()
    const storageKey = storage.buildKey('thumbnail', userId, fileId, 'webp')
    const staging = join(tmpdir(), `thumb-upload-${randomUUID()}.webp`)
    await writeFile(staging, thumbBuffer)
    await storage.save(storageKey, staging)

    const saved = await core.registerFile(
      userId,
      {
        id: fileId,
        kind: 'thumbnail',
        ext: 'webp',
        checksumSha256: checksum,
        originalName: `thumb-${size}.webp`,
        mimeType: 'image/webp',
        sizeBytes: thumbBuffer.length,
      },
      // the register-file route carries no asset id, so the binding scope rides along too
      sig === undefined ? undefined : { sig, scope: assetId },
    )
    // ponytail: checksum dedupe returned another row's id — this uniquely-keyed copy is unreferenced
    if (saved.id !== fileId) await storage.delete(storageKey).catch(() => undefined)

    await core.registerThumbnail(
      userId,
      assetId,
      {
        size,
        fileId: saved.id,
        width: info.width,
        height: info.height,
        bytes: thumbBuffer.length,
      },
      sig === undefined ? undefined : { sig },
    )

    await patchStatusFailed(
      core,
      logger,
      userId,
      assetId,
      {
        thumbnailStatus: 'ready',
      },
      sig,
    )
  }

  return {
    queue: 'process-thumbnail',
    logger,
    listening: 'Thumbnail processor listening for jobs',
    run: async (job) => {
      await runAssetFileJob({ core, storage, logger }, job, {
        queue: 'process-thumbnail',
        schema: thumbnailJobSchema,
        label: 'thumbnail',
        failureLabel: 'Thumbnail',
        detail: (data) => `size=${data.size}`,
        missingModelMarkers: [],
        // video thumbs wait for the metadata job's orientation/duration
        beforeBody: async ({ data, record, asset }) => {
          if (
            !record.mimeType?.startsWith('video/') ||
            asset.metadataStatus !== 'pending' ||
            (data.metadataWaits ?? 0) >= MAX_METADATA_WAITS
          ) {
            return false
          }
          // ponytail: no jobId — the current job is active, BullMQ would dedupe the re-add away; the
          // deferred copy re-fetches the asset itself, which is the ordering point. Ceiling: if this
          // add fails the whole job throws so BullMQ retries it (bounded by attempts:3)
          await bullMq.enqueue(
            'process-thumbnail',
            job.name,
            { ...job.data, metadataWaits: (data.metadataWaits ?? 0) + 1 },
            {
              delay: METADATA_WAIT_DELAY_MS,
              attempts: 3,
              backoff: { type: 'exponential' },
              removeOnComplete: true,
              removeOnFail: true,
            },
          )
          logger.log(
            `Thumbnail deferred (metadata pending): asset=${data.assetId}, size=${data.size}, wait=${(data.metadataWaits ?? 0) + 1}`,
          )
          return true
        },
        onFailure: ({ userId, assetId, sig }) =>
          patchStatusFailed(core, logger, userId, assetId, { thumbnailStatus: 'failed' }, sig),
        body: async ({ data, record, asset, filePath }) => {
          await generateThumbnail(record, asset, data.size, data.userId, filePath, data.sig)

          logger.log(`Thumbnail complete: asset=${data.assetId}, size=${data.size}`)
        },
      })
    },
  }
}
