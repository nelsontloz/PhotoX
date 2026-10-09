import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import { UnrecoverableError, type Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { copyFile, unlink, writeFile } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, thumbnailJobSchema, type ThumbnailJob } from './job-schemas'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'
import type { FileRecord } from '@photox/shared-types'
import { runFfmpeg } from './ffmpeg'

const STANDARD_SIZES: Record<string, [number, number]> = {
  sm: [150, 150],
  md: [300, 300],
  lg: [600, 600],
  xl: [1920, 1920],
}

// ponytail: fit: 'inside' preserves the source aspect ratio (landscape/portrait); 'cover' was cropping to a square, which broke the downstream masonry grid.
const RESIZE_OPTIONS: sharp.ResizeOptions = { fit: 'inside', withoutEnlargement: true }

@Injectable()
export class ThumbnailProcessor {
  private readonly logger = new Logger(ThumbnailProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
  ) {}

  start() {
    this.bullMq.createWorker<ThumbnailJob>('process-thumbnail', (job) => this.processJob(job))

    this.logger.log('Thumbnail processor listening for jobs')
  }

  private async processJob(job: Job<ThumbnailJob>) {
    const { assetId, fileId, size, userId } = parseJobData(
      thumbnailJobSchema,
      job.data,
      'process-thumbnail',
    )

    this.logger.log(`Processing thumbnail: asset=${assetId}, size=${size}`)

    const record = await this.core.getFile(userId, fileId)
    const asset = await this.core.getAsset(userId, assetId)
    assertOwnership({ assetId, fileId, userId }, { record, asset })

    try {
      await this.generateThumbnail(record, assetId, size, userId)

      this.logger.log(`Thumbnail complete: asset=${assetId}, size=${size}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Thumbnail failed: asset=${assetId}, size=${size} — ${message}`)

      try {
        await this.core.patchMetadata(userId, assetId, { thumbnailStatus: 'failed' })
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        this.logger.warn(
          `Failed to patch thumbnail status to failed for asset=${assetId}, size=${size}: ${patchMsg}`,
        )
      }

      throw err
    }
  }

  private async generateThumbnail(
    record: FileRecord,
    assetId: string,
    size: string,
    userId: string,
  ): Promise<void> {
    const dims = STANDARD_SIZES[size]
    if (!dims) throw new Error(`Unknown thumbnail size: ${size}`)
    const [width, height] = dims

    const mimeType = record.mimeType

    const tmpPath = join(tmpdir(), `thumb-${randomUUID()}`)
    try {
      await copyFile(this.storage.pathFor(record.storageKey), tmpPath)

      if (mimeType?.startsWith('video/')) {
        let orientation: number | null = null
        let durationSeconds: number | null = null

        // ponytail: thumbnail and metadata jobs race after upload — wait for metadata to land instead of thumbnailing blind (unrotated, frame 0)
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const asset = await this.core.getAsset(userId, assetId)
            orientation = asset.orientation ?? null
            durationSeconds = asset.durationSeconds !== null ? Number(asset.durationSeconds) : null
            if (asset.metadataStatus !== 'pending') break
          } catch (err) {
            // asset is gone (404 → UnrecoverableError) — polling cannot fix it, fail fast
            if (err instanceof UnrecoverableError) throw err
            // transient core error; retry below
          }
          if (attempt < 4) {
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
        const degrees = orientation === null ? 0 : ((orientation % 360) + 360) % 360
        if (durationSeconds === null || !Number.isFinite(durationSeconds)) durationSeconds = 0

        const seekSec =
          durationSeconds > 0
            ? Math.min(Math.max(0, durationSeconds * 0.25), Math.max(0, durationSeconds - 0.1))
            : 0

        const frameBuffer = (
          await runFfmpeg([
            '-y',
            '-noautorotate',
            '-ss',
            String(seekSec),
            '-i',
            tmpPath,
            '-vframes',
            '1',
            '-f',
            'image2pipe',
            '-',
          ])
        ).stdout

        const { data: thumbBuffer, info } = await this.encodeWebp(
          frameBuffer,
          size,
          width,
          height,
          degrees,
        )

        await this.storeThumbnail(userId, assetId, size, thumbBuffer, info)

        return
      }

      // ponytail: stock sharp prebuilds have no HEIC (HEVC) decoder — route iPhone photos
      // through ffmpeg (has libde265), upgrade to a libheif-capable sharp build if it lands
      if (mimeType === 'image/heic' || mimeType === 'image/heif') {
        try {
          const frameBuffer = (
            await runFfmpeg(['-y', '-i', tmpPath, '-vframes', '1', '-f', 'image2pipe', '-'])
          ).stdout
          const { data: thumbBuffer, info } = await this.encodeWebp(
            frameBuffer,
            size,
            width,
            height,
          )
          await this.storeThumbnail(userId, assetId, size, thumbBuffer, info)
          return
        } catch (err) {
          this.logger.warn(
            `ffmpeg HEIC decode failed for asset=${assetId} — falling back to sharp: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
          )
          // fall through to sharp path, which throws a normal thumbnail failure if HEIC is unsupported
        }
      }

      const { data: thumbBuffer, info } = await this.encodeWebp(tmpPath, size, width, height)

      await this.storeThumbnail(userId, assetId, size, thumbBuffer, info)
    } finally {
      await unlink(tmpPath).catch(() => undefined)
    }
  }

  private async encodeWebp(
    source: Buffer | string,
    size: string,
    width: number,
    height: number,
    rotateDegrees = 0,
  ) {
    let pipeline = sharp(source)
    if (rotateDegrees !== 0) pipeline = pipeline.rotate(rotateDegrees)
    return pipeline
      .resize(width, height, RESIZE_OPTIONS)
      .webp({ quality: size === 'xl' ? 85 : 80 })
      .toBuffer({ resolveWithObject: true })
  }

  private async storeThumbnail(
    userId: string,
    assetId: string,
    size: string,
    thumbBuffer: Buffer,
    info: { width: number; height: number },
  ): Promise<void> {
    const checksum = createHash('sha256').update(thumbBuffer).digest('hex')
    const fileId = randomUUID()
    const storageKey = this.storage.buildKey('thumbnail', userId, fileId, 'webp')
    const staging = join(tmpdir(), `thumb-upload-${randomUUID()}.webp`)
    await writeFile(staging, thumbBuffer)
    await this.storage.save(storageKey, staging)

    const saved = await this.core.registerFile(userId, {
      id: fileId,
      kind: 'thumbnail',
      ext: 'webp',
      checksumSha256: checksum,
      originalName: `thumb-${size}.webp`,
      mimeType: 'image/webp',
      sizeBytes: thumbBuffer.length,
    })
    // ponytail: checksum dedupe returned another row's id — this uniquely-keyed copy is unreferenced
    if (saved.id !== fileId) await this.storage.delete(storageKey).catch(() => undefined)

    await this.core.registerThumbnail(userId, assetId, {
      size,
      fileId: saved.id,
      width: info.width,
      height: info.height,
      bytes: thumbBuffer.length,
    })

    try {
      await this.core.patchMetadata(userId, assetId, { thumbnailStatus: 'ready' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Thumbnail status update failed for asset=${assetId}: ${msg}`)
    }
  }
}
