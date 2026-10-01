import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { copyFile, unlink } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, faceJobSchema, type FaceJob } from './job-schemas'
import { FaceDetectorService } from './face.detector'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService, envFaceDetectorKind } from '@photox/shared-config'

export const CLUSTER_DEBOUNCE_MS = 30_000
export const FACE_MAX_DIM = 2048

@Injectable()
export class FaceProcessor {
  private readonly logger = new Logger(FaceProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
    private readonly faceDetector: FaceDetectorService,
  ) {}

  start() {
    this.bullMq.createWorker<FaceJob>('process-faces', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Face processor listening for jobs')
  }

  private async processJob(job: Job<FaceJob>) {
    const { assetId, fileId, userId, detector } = parseJobData(
      faceJobSchema,
      job.data,
      'process-faces',
    )

    this.logger.log(`Processing faces: asset=${assetId}`)

    // ponytail: resolve once — the same kind drives detection and is persisted as provenance
    const resolvedDetector = detector ?? envFaceDetectorKind()

    const record = await this.core.getFile(userId, fileId)
    const asset = await this.core.getAsset(userId, assetId)
    assertOwnership({ assetId, fileId, userId }, { record, asset })

    const filePath = join(tmpdir(), `face-${randomUUID()}`)
    try {
      await this.core.patchMetadata(userId, assetId, { faceStatus: 'pending' })

      await copyFile(this.storage.pathFor(record.storageKey), filePath)

      const metadata = await sharp(filePath).metadata()
      if (!metadata.width || !metadata.height) {
        throw new Error('Could not read image dimensions')
      }
      // EXIF orientations 5-8 transpose the stored pixels, so the displayed (oriented) original
      // swaps axes; boxes must be stored in that oriented space to match the browser/thumbnails.
      // `.rotate()` below applies the same swap to the detection buffer.
      const swapped = (metadata.orientation ?? 1) >= 5
      const origW = swapped ? metadata.height : metadata.width
      const origH = swapped ? metadata.width : metadata.height

      // ponytail: detection + embedding both run off this downscaled buffer, and the embedder
      // warps 112px crops from it, so 2048 preserves small-face detail (~12MB raw at that size).
      const resized = await sharp(filePath)
        .rotate()
        .resize({
          width: FACE_MAX_DIM,
          height: FACE_MAX_DIM,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer()
      const resizedMeta = await sharp(resized).metadata()
      const resizedW = resizedMeta.width ?? origW
      const resizedH = resizedMeta.height ?? origH

      const scaleX = origW / resizedW
      const scaleY = origH / resizedH

      const detections = await this.faceDetector.detect(resized, resolvedDetector)
      // ponytail: drop low-confidence detections before save — clustering separately ignores conf < 0.4
      const faces = detections
        .filter((d) => d.confidence >= 0.5)
        .map((d) => ({
          box: {
            x: Math.round(d.box.x * scaleX),
            y: Math.round(d.box.y * scaleY),
            w: Math.round(d.box.w * scaleX),
            h: Math.round(d.box.h * scaleY),
          },
          confidence: Math.round(d.confidence * 10000) / 10000,
          embedding: d.embedding,
        }))

      // ponytail: unconditional delete + re-save after a successful detect — retry-safe replace
      // (was re-embed-only, so a retried job duplicated faces); never before detect, to avoid data loss
      await this.core.deleteAssetFaces(userId, assetId)
      if (faces.length > 0) {
        await this.core.registerFaces(userId, assetId, faces, resolvedDetector)
      }

      await this.core.patchMetadata(userId, assetId, {
        faceStatus: 'ready',
        faceCount: faces.length,
      })

      this.logger.log(`Faces complete: asset=${assetId}, count=${faces.length}`)

      // enqueue() logs-and-swallows add failures, so a Redis hiccup here cannot fail the face job
      if (faces.length > 0) {
        await this.bullMq.enqueue(
          'process-faces-cluster',
          'cluster',
          { userId, reason: 'face-detected' },
          {
            // ponytail: fixed jobId + delay debounces a detection burst into one trailing run
            // (BullMQ ignores same jobId while waiting/active). Ceiling: faces uploaded during an
            // active run are picked up on the next upload or manual trigger — add a trailing re-run
            // check if that liveness matters
            jobId: `cluster-${userId}`,
            delay: CLUSTER_DEBOUNCE_MS,
            removeOnComplete: true,
            removeOnFail: true,
            attempts: 3,
            backoff: { type: 'exponential' },
          },
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // ponytail: missing model weights are provisioning, not a job bug — warn + no retry
      if (
        message.includes('Face embedding model not found') ||
        message.includes('Face detector model not found')
      ) {
        this.logger.warn(`Faces skipped (missing model): asset=${assetId} — ${message}`)

        try {
          await this.core.patchMetadata(userId, assetId, { faceStatus: 'failed' })
        } catch (patchErr) {
          const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
          this.logger.warn(
            `Failed to patch face status to failed for asset=${assetId}: ${patchMsg}`,
          )
        }

        return
      }
      this.logger.error(`Faces failed: asset=${assetId} — ${message}`)

      try {
        await this.core.patchMetadata(userId, assetId, { faceStatus: 'failed' })
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        this.logger.warn(`Failed to patch face status to failed for asset=${assetId}: ${patchMsg}`)
      }

      throw err
    } finally {
      await unlink(filePath).catch(() => undefined)
    }
  }
}
