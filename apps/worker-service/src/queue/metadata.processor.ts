import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { Job } from 'bullmq'
import { readFile, copyFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, metadataJobSchema, type MetadataJob } from './job-schemas'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'
import { computeDhash, DHASH_HEIGHT, DHASH_WIDTH } from './dhash'

export function branchFor(mimeType: string | null): 'photo' | 'video' | null {
  if (mimeType?.startsWith('image/')) return 'photo'
  if (mimeType?.startsWith('video/')) return 'video'
  return null
}

@Injectable()
export class MetadataProcessor implements OnModuleInit {
  private readonly logger = new Logger(MetadataProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
    private readonly metadataExtractor: MetadataExtractor,
    private readonly videoMetadataExtractor: VideoMetadataExtractor,
  ) {}

  onModuleInit() {
    this.bullMq.createWorker<MetadataJob>('process-metadata', (job) => this.processJob(job))

    this.logger.log('Metadata processor listening for jobs')
  }

  private async processJob(job: Job<MetadataJob>) {
    const { assetId, fileId, userId } = parseJobData(
      metadataJobSchema,
      job.data,
      'process-metadata',
    )

    this.logger.log(`Processing metadata: asset=${assetId}`)

    const record = await this.core.getFile(userId, fileId)
    const asset = await this.core.getAsset(userId, assetId)
    assertOwnership({ assetId, fileId, userId }, { record, asset })

    const filePath = join(tmpdir(), `metadata-${randomUUID()}`)
    try {
      await copyFile(this.storage.pathFor(record.storageKey), filePath)
      const mimeType = record.mimeType ?? null
      const sizeBytes = record.sizeBytes
      const originalName = record.originalName ?? null

      const branch = branchFor(mimeType)
      if (!branch) {
        this.logger.warn(`Unknown mime type ${mimeType}, skipping metadata: asset=${assetId}`)
        return
      }

      if (branch === 'photo') {
        const metadata = this.metadataExtractor.extract(await readFile(filePath))
        const hasAnyField = Object.values(metadata).some((v) => v !== null)
        const metadataStatus = hasAnyField ? 'ready' : 'failed'

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
          this.logger.warn(`dHash failed: asset=${assetId} — ${message}`)
        }

        await this.core.patchMetadata(userId, assetId, {
          ...metadata,
          // EXIF iso can be rational (e.g. 201/2) — the DTO gates iso with @IsInt
          iso: metadata.iso === null ? null : Math.round(metadata.iso),
          mimeType,
          sizeBytes,
          originalName,
          status: metadataStatus,
          metadata: null,
          ...(phash === null ? {} : { phash }),
        })
      } else if (branch === 'video') {
        const videoMeta = await this.videoMetadataExtractor.extract(filePath)
        const hasAnyVideoField = [
          videoMeta.durationSeconds,
          videoMeta.width,
          videoMeta.height,
          videoMeta.codec,
          videoMeta.fps,
          videoMeta.hasAudio,
          videoMeta.orientation,
          videoMeta.takenAt,
          videoMeta.cameraMake,
          videoMeta.cameraModel,
          videoMeta.lensModel,
          videoMeta.latitude,
          videoMeta.longitude,
          videoMeta.altitude,
        ].some((v) => v !== null)
        const videoMetadataStatus = hasAnyVideoField ? 'ready' : 'failed'
        await this.core.patchMetadata(userId, assetId, {
          status: videoMetadataStatus,
          mimeType,
          durationSeconds: videoMeta.durationSeconds,
          width: videoMeta.width,
          height: videoMeta.height,
          codec: videoMeta.codec,
          fps: videoMeta.fps,
          hasAudio: videoMeta.hasAudio,
          orientation: videoMeta.orientation,
          sizeBytes,
          originalName,
          takenAt: videoMeta.takenAt,
          cameraMake: videoMeta.cameraMake,
          cameraModel: videoMeta.cameraModel,
          lensModel: videoMeta.lensModel,
          latitude: videoMeta.latitude,
          longitude: videoMeta.longitude,
          altitude: videoMeta.altitude,
          metadata: null,
        })
      }

      this.logger.log(`Metadata complete: asset=${assetId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Metadata failed: asset=${assetId} — ${message}`)

      try {
        await this.core.patchMetadata(userId, assetId, { status: 'failed' })
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        this.logger.warn(
          `Failed to patch metadata status to failed for asset=${assetId}: ${patchMsg}`,
        )
      }

      throw err
    } finally {
      await unlink(filePath).catch(() => undefined)
    }
  }
}
