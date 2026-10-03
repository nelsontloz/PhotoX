import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { copyFile, unlink } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, detectionJobSchema, type DetectionJob } from './job-schemas'
import { DetectService, scaleDetectionsToOriginal } from './detect.service'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'

// detection only needs scene-level objects, so a 1280px long side is plenty before the model's
// own 640px letterbox — the service records the geometry, not this prep
export const DETECT_MAX_DIM = 1280

@Injectable()
export class DetectProcessor {
  private readonly logger = new Logger(DetectProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
    private readonly detect: DetectService,
  ) {}

  start() {
    this.bullMq.createWorker<DetectionJob>('process-detect', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Detection processor listening for jobs')
  }

  private async processJob(job: Job<DetectionJob>) {
    const { assetId, fileId, userId } = parseJobData(detectionJobSchema, job.data, 'process-detect')

    this.logger.log(`Processing detection: asset=${assetId}`)

    const record = await this.core.getFile(userId, fileId)
    const asset = await this.core.getAsset(userId, assetId)
    assertOwnership({ assetId, fileId, userId }, { record, asset })

    const filePath = join(tmpdir(), `detect-${randomUUID()}`)
    try {
      await copyFile(this.storage.pathFor(record.storageKey), filePath)

      const metadata = await sharp(filePath).metadata()
      if (!metadata.width || !metadata.height) {
        throw new Error('Could not read image dimensions')
      }
      // EXIF orientations 5-8 transpose the stored pixels, so the displayed (oriented) original
      // swaps axes; boxes must land in that same oriented space the web viewer scales by
      const swapped = (metadata.orientation ?? 1) >= 5
      const origW = swapped ? metadata.height : metadata.width
      const origH = swapped ? metadata.width : metadata.height

      // ponytail: EXIF-oriented ≤1280px long side — the model's own letterbox goes to 640, then
      // scaleDetectionsToOriginal maps boxes from this prep space back to ORIGINAL px below
      const resized = await sharp(filePath)
        .rotate()
        .resize({
          width: DETECT_MAX_DIM,
          height: DETECT_MAX_DIM,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer()
      const resizedMeta = await sharp(resized).metadata()
      const resizedW = resizedMeta.width ?? origW
      const resizedH = resizedMeta.height ?? origH

      const scaleX = origW / resizedW
      const scaleY = origH / resizedH

      const detections = await this.detect.detect(resized)
      const scaled = scaleDetectionsToOriginal(detections, scaleX, scaleY, origW, origH)

      // replace-semantics: core deletes the asset's whole row set and inserts this one, so an
      // empty array MUST be registered — that is what clears stale rows on a re-run
      await this.core.registerDetections(userId, assetId, { detections: scaled })

      this.logger.log(`Detection complete: asset=${assetId}, count=${scaled.length}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // ponytail: missing model weights are provisioning, not a job bug — warn + no retry.
      // No metadata status marker: core's UpdateMetadataDto has no detection status field
      if (message.includes('Detection model not found')) {
        this.logger.warn(`Detection skipped (missing model): asset=${assetId} — ${message}`)
        return
      }
      this.logger.error(`Detection failed: asset=${assetId} — ${message}`)
      throw err
    } finally {
      await unlink(filePath).catch(() => undefined)
    }
  }
}
