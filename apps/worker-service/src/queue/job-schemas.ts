import { UnrecoverableError } from 'bullmq'
import { z } from 'zod'
import { FACE_DETECTOR_KINDS } from '@photox/shared-types'

const uuid = z.string().uuid()

const jobRefs = {
  assetId: uuid,
  fileId: uuid,
  userId: uuid,
}

export const thumbnailJobSchema = z.object({
  ...jobRefs,
  size: z.enum(['sm', 'md', 'lg', 'xl']),
  // bounded defer counter the thumbnail processor sets when it re-enqueues a video job while
  // metadata is still pending — absent on upload payloads
  metadataWaits: z.number().int().min(0).max(10).optional(),
})

// video/metadata/embedding/ocr/detection jobs carry only the three refs — one base schema, aliased per queue
const assetRefsJobSchema = z.object({
  ...jobRefs,
})

export const videoJobSchema = assetRefsJobSchema

export const metadataJobSchema = assetRefsJobSchema

export const faceJobSchema = z.object({
  ...jobRefs,
  detector: z.enum(FACE_DETECTOR_KINDS).optional(),
})

export const embeddingJobSchema = assetRefsJobSchema

export const ocrJobSchema = assetRefsJobSchema

export const detectionJobSchema = assetRefsJobSchema

export const clusterJobSchema = z.object({
  userId: uuid,
})

export const cleanupJobSchema = z.object({
  fileId: uuid,
})

export const cleanupOrphansJobSchema = z.object({})

export type ThumbnailJob = z.infer<typeof thumbnailJobSchema>
export type VideoJob = z.infer<typeof videoJobSchema>
export type MetadataJob = z.infer<typeof metadataJobSchema>
export type FaceJob = z.infer<typeof faceJobSchema>
export type EmbeddingJob = z.infer<typeof embeddingJobSchema>
export type OcrJob = z.infer<typeof ocrJobSchema>
export type DetectionJob = z.infer<typeof detectionJobSchema>
export type ClusterJob = z.infer<typeof clusterJobSchema>
export type CleanupJob = z.infer<typeof cleanupJobSchema>
export type CleanupOrphansJob = z.infer<typeof cleanupOrphansJobSchema>

export function parseJobData<T>(schema: z.ZodType<T>, data: unknown, queue: string): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new UnrecoverableError(`Invalid ${queue} job payload: ${detail}`)
  }
  return parsed.data
}

export function assertOwnership(
  job: { assetId: string; fileId: string; userId: string },
  loaded: {
    // structural shapes — accept CoreClient DTOs and core entity rows alike
    record: { userId: string } | null
    asset: { userId: string; fileId?: string } | null
  },
): void {
  const mismatch =
    (loaded.record !== null && loaded.record.userId !== job.userId) ||
    (loaded.asset !== null && loaded.asset.userId !== job.userId) ||
    (loaded.asset !== null && loaded.asset.fileId !== job.fileId)
  if (mismatch) {
    throw new UnrecoverableError(
      `Ownership mismatch: asset=${job.assetId} file=${job.fileId} user=${job.userId}`,
    )
  }
}
