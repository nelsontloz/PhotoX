import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { faceJobSchema, type FaceJob } from './job-schemas'
import { runAssetFileJob } from './asset-file-job'
import { FaceDetectorService } from './face.detector'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService, envFaceDetectorKind } from '@photox/shared-config'

export const CLUSTER_DEBOUNCE_MS = 30_000
export const FACE_MAX_DIM = 2048

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

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
    this.bullMq.createWorker<FaceJob>('process-faces', (job) => this.processJob(job))

    this.logger.log('Face processor listening for jobs')
  }

  private async processJob(job: Job<FaceJob>) {
    await runAssetFileJob({ core: this.core, storage: this.storage, logger: this.logger }, job, {
      queue: 'process-faces',
      schema: faceJobSchema,
      label: 'Faces',
      // ponytail: missing model weights are provisioning, not a job bug — warn + no retry
      missingModelMarkers: ['Face embedding model not found', 'Face detector model not found'],
      onFailure: ({ userId, assetId }) => this.markFailed(userId, assetId),
      body: async ({ data, filePath }) => {
        const { assetId, userId } = data
        // ponytail: resolve once — the same kind drives detection and is persisted as provenance
        const resolvedDetector = data.detector ?? envFaceDetectorKind()

        await this.core.patchMetadata(userId, assetId, { faceStatus: 'pending' })

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
          .map((d) => {
            // ponytail: detector boxes can poke past the frame (SCRFD especially) — clamp each edge
            // to the oriented original so core's @Min(0) box DTO accepts them and crops stay in-bounds
            const x1 = clamp(Math.round(d.box.x * scaleX), 0, origW)
            const y1 = clamp(Math.round(d.box.y * scaleY), 0, origH)
            const x2 = clamp(Math.round((d.box.x + d.box.w) * scaleX), 0, origW)
            const y2 = clamp(Math.round((d.box.y + d.box.h) * scaleY), 0, origH)
            return {
              box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
              confidence: Math.round(d.confidence * 10000) / 10000,
              embedding: d.embedding,
            }
          })
          // a box entirely outside the frame collapses to zero/negative extent — never register it
          .filter((d) => d.box.w > 0 && d.box.h > 0)

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
      },
    })
  }

  private async markFailed(userId: string, assetId: string): Promise<void> {
    try {
      await this.core.patchMetadata(userId, assetId, { faceStatus: 'failed' })
    } catch (patchErr) {
      const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
      this.logger.warn(`Failed to patch face status to failed for asset=${assetId}: ${patchMsg}`)
    }
  }
}
