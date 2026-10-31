import { Logger } from '@nestjs/common'
import { readFile } from 'fs/promises'
import sharp from 'sharp'
import { assetRefsJobSchema, bindingOf, type AssetRefsJob } from './job-schemas'
import { patchStatusFailed, runAssetFileJob } from './asset-file-job'
import type { ProcessorDeps, ProcessorSpec } from './processor-spec'
import { computeDhash, DHASH_HEIGHT, DHASH_WIDTH } from './dhash'

export function branchFor(mimeType: string | null): 'photo' | 'video' | null {
  if (mimeType?.startsWith('image/')) return 'photo'
  if (mimeType?.startsWith('video/')) return 'video'
  return null
}

export function metadataProcessor({
  core,
  storage,
  metadataExtractor,
  videoMetadataExtractor,
}: Pick<
  ProcessorDeps,
  'core' | 'storage' | 'metadataExtractor' | 'videoMetadataExtractor'
>): ProcessorSpec<AssetRefsJob> {
  const logger = new Logger('MetadataProcessor')

  return {
    queue: 'process-metadata',
    logger,
    listening: 'Metadata processor listening for jobs',
    run: async (job) => {
      await runAssetFileJob({ core, storage, logger }, job, {
        queue: 'process-metadata',
        schema: assetRefsJobSchema,
        label: 'metadata',
        failureLabel: 'Metadata',
        missingModelMarkers: [],
        onFailure: ({ userId, assetId, sig }) =>
          patchStatusFailed(core, logger, userId, assetId, { status: 'failed' }, sig),
        body: async ({ data, record, filePath }) => {
          const { assetId, userId } = data
          const mimeType = record.mimeType ?? null
          const sizeBytes = record.sizeBytes
          const originalName = record.originalName ?? null

          const branch = branchFor(mimeType)
          if (!branch) {
            logger.warn(`Unknown mime type ${mimeType}, skipping metadata: asset=${assetId}`)
            return
          }

          if (branch === 'photo') {
            const metadata = metadataExtractor.extract(await readFile(filePath))
            const hasAnyField = Object.values(metadata).some((v) => v !== null)
            const metadataStatus = hasAnyField ? 'ready' : 'failed'
            // never send a null takenAt: the upload request may carry a client-supplied one that a
            // patch field would overwrite
            const { takenAt, ...metadataFields } = metadata

            // ponytail: dHash must never fail the metadata job — on error warn and OMIT the field
            // (a missing hash only costs dupe detection; a failed patch loses all metadata)
            let phash: string | null = null
            try {
              const grayscale = await sharp(filePath)
                .rotate()
                .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill' })
                .grayscale()
                .raw()
                .toBuffer()
              phash = computeDhash(grayscale, DHASH_WIDTH, DHASH_HEIGHT)
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              logger.warn(`dHash failed: asset=${assetId} — ${message}`)
            }

            await core.patchMetadata(
              userId,
              assetId,
              {
                ...metadataFields,
                // EXIF iso can be rational (e.g. 201/2) — the DTO gates iso with @IsInt
                iso: metadata.iso === null ? null : Math.round(metadata.iso),
                mimeType,
                sizeBytes,
                originalName,
                status: metadataStatus,
                metadata: null,
                ...(phash === null ? {} : { phash }),
                ...(takenAt === null ? {} : { takenAt }),
              },
              bindingOf(data),
            )
          } else if (branch === 'video') {
            const videoMeta = await videoMetadataExtractor.extract(filePath)
            const hasAnyVideoField = Object.values(videoMeta).some((v) => v !== null)
            const videoMetadataStatus = hasAnyVideoField ? 'ready' : 'failed'
            // same rule as photos: an absent probe date must not clobber a client-supplied takenAt
            const { takenAt: videoTakenAt, ...videoFields } = videoMeta
            await core.patchMetadata(
              userId,
              assetId,
              {
                status: videoMetadataStatus,
                mimeType,
                ...videoFields,
                sizeBytes,
                originalName,
                ...(videoTakenAt === null ? {} : { takenAt: videoTakenAt }),
                metadata: null,
              },
              bindingOf(data),
            )
          }

          logger.log(`Metadata complete: asset=${assetId}`)
        },
      })
    },
  }
}
