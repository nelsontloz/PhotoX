import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { Job } from 'bullmq'
import { readFile, stat, copyFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, metadataJobSchema, type MetadataJob } from './job-schemas'
import { Asset, FileRecord, LocalStorageService } from '@photox/data-access'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'

export function branchFor(mimeType: string | null): 'photo' | 'video' | null {
  if (mimeType?.startsWith('image/')) return 'photo'
  if (mimeType?.startsWith('video/')) return 'video'
  return null
}

@Injectable()
export class MetadataProcessor {
  private readonly logger = new Logger(MetadataProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly storage: LocalStorageService,
    private readonly metadataExtractor: MetadataExtractor,
    private readonly videoMetadataExtractor: VideoMetadataExtractor,
  ) {}

  start() {
    this.bullMq.createWorker<MetadataJob>('process-metadata', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Metadata processor listening for jobs')
  }

  private async processJob(job: Job<MetadataJob>) {
    const { assetId, fileId, kind, userId } = parseJobData(
      metadataJobSchema,
      job.data,
      'process-metadata',
    )

    this.logger.log(`Processing metadata: asset=${assetId}, kind=${kind}`)

    const record = await this.fileRepo.findOne({ where: { id: fileId } })
    const asset = await this.assetRepo.findOne({ where: { id: assetId } })
    assertOwnership({ assetId, fileId, userId }, { record, asset })

    const filePath = join(tmpdir(), `metadata-${randomUUID()}`)
    try {
      if (!record) throw new Error(`File not found: ${fileId}`)
      await copyFile(this.storage.pathFor(record.storageKey), filePath)
      const mimeType = record.mimeType ?? null
      const sizeBytes = (await stat(filePath)).size
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

        await this.assetRepo.update(assetId, {
          takenAt: metadata.takenAt,
          cameraMake: metadata.cameraMake,
          cameraModel: metadata.cameraModel,
          lensModel: metadata.lensModel,
          orientation: metadata.orientation,
          latitude: metadata.latitude,
          longitude: metadata.longitude,
          iso: metadata.iso,
          fNumber: metadata.fNumber,
          exposureTime: metadata.exposureTime,
          focalLength: metadata.focalLength,
          altitude: metadata.altitude,
          mimeType,
          sizeBytes,
          originalName,
          metadataStatus,
          metadataExtractedAt: new Date(),
          width: metadata.width,
          height: metadata.height,
          metadata: null,
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
        await this.assetRepo.update(assetId, {
          metadataStatus: videoMetadataStatus,
          metadataExtractedAt: new Date(),
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
        await this.assetRepo.update(assetId, {
          metadataStatus: 'failed',
          metadataExtractedAt: new Date(),
        })
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
