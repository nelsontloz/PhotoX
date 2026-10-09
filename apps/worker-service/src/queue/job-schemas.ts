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
})

export const videoJobSchema = z.object({
  ...jobRefs,
})

export const metadataJobSchema = z.object({
  ...jobRefs,
  kind: z.enum(['photo', 'video']),
})

export const faceJobSchema = z.object({
  ...jobRefs,
  reason: z.enum(['initial', 're-embed']).optional(),
  detector: z.enum(FACE_DETECTOR_KINDS).optional(),
})

export const embeddingJobSchema = z.object({
  ...jobRefs,
})

export const ocrJobSchema = z.object({
  ...jobRefs,
})

export const detectionJobSchema = z.object({
  ...jobRefs,
})

export const clusterJobSchema = z.object({
  userId: uuid,
  reason: z.enum(['face-detected', 'manual']).optional(),
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
