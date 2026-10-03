import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { copyFile, unlink } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, detectionJobSchema, type DetectionJob } from './job-schemas'
import { DetectService } from './detect.service'
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

      // ponytail: EXIF-oriented ≤1280px long side — the model's letterbox goes to 640 and maps
      // boxes back to original pixels itself, so this pass only trims decode cost
      const resized = await sharp(filePath)
        .rotate()
        .resize({
          width: DETECT_MAX_DIM,
          height: DETECT_MAX_DIM,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer()

      const detections = await this.detect.detect(resized)

      // replace-semantics: core deletes the asset's whole row set and inserts this one, so an
      // empty array MUST be registered — that is what clears stale rows on a re-run
      await this.core.registerDetections(userId, assetId, { detections })

      this.logger.log(`Detection complete: asset=${assetId}, count=${detections.length}`)
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
