import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { faceJobSchema, bindingOf, type FaceJob } from './job-schemas'
import { orientedPrep, patchStatusFailed, runAssetFileJob } from './asset-file-job'
import { FaceDetectorService } from './face.detector'
import { scaleDetectionsToOriginal } from './detect.service'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService, envFaceDetectorKind } from '@photox/shared-config'

export const CLUSTER_DEBOUNCE_MS = 30_000
export const FACE_MAX_DIM = 2048

@Injectable()
export class FaceProcessor implements OnModuleInit {
  private readonly logger = new Logger(FaceProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
    private readonly faceDetector: FaceDetectorService,
  ) {}

  onModuleInit() {
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
      onFailure: ({ userId, assetId, sig }) =>
        patchStatusFailed(this.core, this.logger, userId, assetId, { faceStatus: 'failed' }, sig),
      body: async ({ data, filePath }) => {
        const { assetId, userId } = data
        // ponytail: resolve once — the same kind drives detection and is persisted as provenance
        const resolvedDetector = data.detector ?? envFaceDetectorKind()
        const binding = bindingOf(data)

        await this.core.patchMetadata(userId, assetId, { faceStatus: 'pending' }, binding)

        // ponytail: detection + embedding both run off this downscaled buffer, and the embedder
        // warps 112px crops from it, so 2048 preserves small-face detail (~12MB raw at that size).
        const { resized, scaleX, scaleY, origW, origH } = await orientedPrep(filePath, FACE_MAX_DIM)

        const detections = await this.faceDetector.detect(resized, resolvedDetector)
        // ponytail: drop low-confidence detections before save — clustering separately ignores conf < 0.4
        const faces = scaleDetectionsToOriginal(
          detections.filter((d) => d.confidence >= 0.5),
          scaleX,
          scaleY,
          origW,
          origH,
        ).map((d) => ({
          box: d.box,
          confidence: d.confidence,
          embedding: d.embedding,
        }))

        // ponytail: unconditional delete + re-save after a successful detect — retry-safe replace
        // (was re-embed-only, so a retried job duplicated faces); never before detect, to avoid data loss
        await this.core.deleteAssetFaces(userId, assetId, binding)
        if (faces.length > 0) {
          await this.core.registerFaces(userId, assetId, faces, resolvedDetector, binding)
        }

        await this.core.patchMetadata(
          userId,
          assetId,
          {
            faceStatus: 'ready',
            faceCount: faces.length,
          },
          binding,
        )

        this.logger.log(`Faces complete: asset=${assetId}, count=${faces.length}`)

        // a lost cluster debounce fails the face job so BullMQ retries it — detection itself is
        // idempotent (delete + re-save above), so the retry is cheap
        if (faces.length > 0) {
          const clusterQueued = await this.bullMq.enqueue(
            'process-faces-cluster',
            'cluster',
            { userId },
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
          if (!clusterQueued) throw new Error(`Failed to enqueue cluster job for user=${userId}`)
        }
      },
    })
  }
}
