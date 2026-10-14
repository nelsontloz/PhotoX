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

/** POST /v1/admin/backups response: what got copied, under which S3 prefix. Mirrors the core backup contract (uploaded + skipped split of files for incremental runs). */
export interface BackupResult {
  userId: string
  email: string
  prefix: string
  backedUpAt: string
  files: number
  uploaded: number
  skipped: number
  assets: number
  albums: number
  shares: number
  persons: number
}

/** GET /v1/admin/backups/status response: manifest presence + row counts (absent fields when none). */
export interface BackupStatus {
  exists: boolean
  degraded?: 'unreadable' | 'corrupt'
  userId?: string
  emailAtBackup?: string
  backedUpAt?: string
  files?: number
  assets?: number
  albums?: number
  shares?: number
  persons?: number
}

/**
 * GET /v1/admin/backups/progress response: per-file progress of an in-flight inline backup.
 * total/completed cover original files; uploaded/skipped split the completed ones.
 */
export interface BackupProgress {
  userId: string
  inProgress: boolean
  total: number
  completed: number
  uploaded: number
  skipped: number
  currentFile?: string
  startedAt?: string
  updatedAt?: string
}

/**
 * Client-side preview of the S3 prefix a user's backup lands under. Mirrors
 * backupPrefix() in @photox/shared-config (normalizeEmail + segment-wise
 * encodeURIComponent) without taking a workspace dep.
 */
export function backupPrefixPreview(email: string, userId: string): string {
  const normalized = email.trim().toLowerCase()
  return `backups/${encodeURIComponent(normalized)}__${encodeURIComponent(userId)}/`
}

// Backups run inline in core (originals first, manifest last) and routinely outlive the client's
// 10s default on multi-GB libraries — raise the cap instead of failing a healthy backup.
const BACKUP_TIMEOUT_MS = 600_000

// Status reads the manifest back from S3 and can stall when the store is slow — give it
// headroom over the generic 10s client default without touching the shared timeout.
const BACKUP_STATUS_TIMEOUT_MS = 30_000

export async function backupUser(emailOrId: string): Promise<BackupResult> {
  const { data } = await api.post<BackupResult>(
    '/v1/admin/backups',
    { emailOrId },
    { timeout: BACKUP_TIMEOUT_MS },
  )
  return data
}

export async function getBackupStatus(emailOrId: string): Promise<BackupStatus> {
  const { data } = await api.get<BackupStatus>('/v1/admin/backups/status', {
    params: { emailOrId },
    timeout: BACKUP_STATUS_TIMEOUT_MS,
  })
  return data
}

export async function getBackupProgress(emailOrId: string): Promise<BackupProgress> {
  const { data } = await api.get<BackupProgress>('/v1/admin/backups/progress', {
    params: { emailOrId },
    timeout: BACKUP_STATUS_TIMEOUT_MS,
  })
  return data
}
