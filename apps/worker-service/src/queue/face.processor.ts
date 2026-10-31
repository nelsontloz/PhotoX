import { Logger } from '@nestjs/common'
import { faceJobSchema, bindingOf, type FaceJob } from './job-schemas'
import { orientedPrep, patchStatusFailed, runAssetFileJob } from './asset-file-job'
import type { ProcessorDeps, ProcessorSpec } from './processor-spec'
import { scaleDetectionsToOriginal } from './detect.service'

export const CLUSTER_DEBOUNCE_MS = 30_000
export const FACE_MAX_DIM = 2048

export function faceProcessor({
  bullMq,
  core,
  storage,
  faceDetector,
}: Pick<ProcessorDeps, 'bullMq' | 'core' | 'storage' | 'faceDetector'>): ProcessorSpec<FaceJob> {
  const logger = new Logger('FaceProcessor')

  return {
    queue: 'process-faces',
    logger,
    listening: 'Face processor listening for jobs',
    run: async (job) => {
      await runAssetFileJob({ core, storage, logger }, job, {
        queue: 'process-faces',
        schema: faceJobSchema,
        label: 'Faces',
        // ponytail: missing model weights are provisioning, not a job bug — warn + no retry
        missingModelMarkers: ['Face embedding model not found', 'Face detector model not found'],
        onFailure: ({ userId, assetId, sig }) =>
          patchStatusFailed(core, logger, userId, assetId, { faceStatus: 'failed' }, sig),
        body: async ({ data, filePath }) => {
          const { assetId, userId } = data
          const binding = bindingOf(data)

          await core.patchMetadata(userId, assetId, { faceStatus: 'pending' }, binding)

          // ponytail: detection + embedding both run off this downscaled buffer, and the embedder
          // warps 112px crops from it, so 2048 preserves small-face detail (~12MB raw at that size).
          const { resized, scaleX, scaleY, origW, origH } = await orientedPrep(
            filePath,
            FACE_MAX_DIM,
          )

          const detections = await faceDetector.detect(resized)
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
          await core.deleteAssetFaces(userId, assetId, binding)
          if (faces.length > 0) {
            await core.registerFaces(userId, assetId, faces, binding)
          }

          await core.patchMetadata(
            userId,
            assetId,
            {
              faceStatus: 'ready',
              faceCount: faces.length,
            },
            binding,
          )

          logger.log(`Faces complete: asset=${assetId}, count=${faces.length}`)

          // a lost cluster debounce fails the face job so BullMQ retries it — detection itself is
          // idempotent (delete + re-save above), so the retry is cheap
          if (faces.length > 0) {
            await bullMq.enqueue(
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
          }
        },
      })
    },
  }
}
