import { api } from './client'
import type {
  AdminUserListResponse,
  AdminUserSortField,
  AdminAssetCountsResponse,
  AdminReprocessThumbnailsResponse,
  FaceDetectionSettings,
  FaceDetectorKind,
} from '@photox/shared-types'

export interface FaceReprocessStatus {
  lastRun: {
    startedAt: string
    total: number
    enqueued: number
    detector: FaceDetectorKind
  } | null
  queue: { waiting: number; active: number; completed: number; failed: number; delayed: number }
}

export interface FaceReprocessResponse {
  enqueued: number
  total: number
  detector: FaceDetectorKind
}

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

export async function reprocessFaces(): Promise<FaceReprocessResponse> {
  const { data } = await api.post<FaceReprocessResponse>('/v1/admin/faces/reprocess')
  return data
}

export async function getFaceReprocessStatus(): Promise<FaceReprocessStatus> {
  const { data } = await api.get<FaceReprocessStatus>('/v1/admin/faces/reprocess')
  return data
}

export async function reclusterFaces(): Promise<{ enqueued: number }> {
  const { data } = await api.post<{ enqueued: number }>('/v1/admin/faces/recluster')
  return data
}
