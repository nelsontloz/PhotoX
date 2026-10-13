import { api } from './client'
import type {
  AdminUserListResponse,
  AdminUserSortField,
  AdminAssetCountsResponse,
  AdminLibraryStatsResponse,
  AdminReprocessThumbnailsResponse,
  FaceDetectionSettings,
  FaceDetectorKind,
} from '@photox/shared-types'

export interface QueueCounts {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

/** Status envelope shared by every reprocess pipeline: last run (if any) + live queue depth. */
export interface ReprocessStatus<L> {
  lastRun: L | null
  queue: QueueCounts
}

/** A completed pipeline run: when it started, how many photos it covered, how many got queued. */
export interface PipelineRun {
  startedAt: string
  total: number
  enqueued: number
}

/** POST response of a pipeline reprocess: how many jobs were queued out of how many photos. */
export interface PipelineResponse {
  enqueued: number
  total: number
}

export type PipelinePath = 'faces' | 'embeddings' | 'detections' | 'ocr'

export async function reprocessPipeline<R extends PipelineResponse>(
  path: PipelinePath,
): Promise<R> {
  const { data } = await api.post<R>(`/v1/admin/${path}/reprocess`)
  return data
}

export async function getPipelineStatus<L extends PipelineRun>(
  path: PipelinePath,
): Promise<ReprocessStatus<L>> {
  const { data } = await api.get<ReprocessStatus<L>>(`/v1/admin/${path}/reprocess`)
  return data
}

export type FacePipelineRun = PipelineRun & { detector: FaceDetectorKind }
export type FaceReprocessStatus = ReprocessStatus<FacePipelineRun>
export interface FaceReprocessResponse extends PipelineResponse {
  detector: FaceDetectorKind
}

export type EmbeddingPipelineRun = PipelineRun & { model: string }
export type EmbeddingReprocessStatus = ReprocessStatus<EmbeddingPipelineRun>
export interface EmbeddingReprocessResponse extends PipelineResponse {
  model: string
}

export type DetectionReprocessStatus = ReprocessStatus<PipelineRun>
export type OcrReprocessStatus = ReprocessStatus<PipelineRun>

export interface ListAdminUsersParams {
  limit?: number
  offset?: number
  q?: string
  sortField?: AdminUserSortField
  sortDir?: 'asc' | 'desc'
  role?: 'user' | 'admin'
}

export async function listAdminUsers(
  params: ListAdminUsersParams = {},
): Promise<AdminUserListResponse> {
  const sort = params.sortField ? `${params.sortField}:${params.sortDir ?? 'desc'}` : undefined
  const { data } = await api.get<AdminUserListResponse>('/v1/admin/users', {
    params: {
      limit: params.limit,
      offset: params.offset,
      q: params.q,
      sort,
      role: params.role,
    },
  })
  return data
}

export async function getAdminAssetCounts(): Promise<AdminAssetCountsResponse> {
  const { data } = await api.get<AdminAssetCountsResponse>('/v1/admin/assets/counts')
  return data
}

export async function getAdminLibraryStats(): Promise<AdminLibraryStatsResponse> {
  const { data } = await api.get<AdminLibraryStatsResponse>('/v1/admin/assets/stats')
  return data
}

export async function reprocessThumbnails(
  kind: 'photo' | 'video',
): Promise<AdminReprocessThumbnailsResponse> {
  const { data } = await api.post<AdminReprocessThumbnailsResponse>(
    '/v1/admin/thumbnails/reprocess',
    { kind },
  )
  return data
}

export async function cleanupOrphans(): Promise<{ enqueued: boolean }> {
  const { data } = await api.post<{ enqueued: boolean }>('/v1/admin/cleanup-orphans')
  return data
}

export async function getOrphanCounts(): Promise<{
  orphanFiles: number
  orphanThumbnails: number
}> {
  const { data } = await api.get<{ orphanFiles: number; orphanThumbnails: number }>(
    '/v1/admin/orphan-counts',
  )
  return data
}

export async function getFaceDetection(): Promise<FaceDetectionSettings> {
  const { data } = await api.get<FaceDetectionSettings>('/v1/admin/face-detection')
  return data
}

export async function setFaceDetector(detector: FaceDetectorKind): Promise<FaceDetectionSettings> {
  const { data } = await api.put<FaceDetectionSettings>('/v1/admin/face-detection', { detector })
  return data
}

export async function reclusterFaces(): Promise<{ enqueued: number }> {
  const { data } = await api.post<{ enqueued: number }>('/v1/admin/faces/recluster')
  return data
}
