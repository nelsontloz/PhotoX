import { api } from './client'
import { sleep } from '../lib/sleep'
import type {
  AdminUserDeleteResponse,
  AdminUserDeleteStatus as AdminUserDeleteBackendStatus,
  AdminUserListResponse,
  AdminUserSortField,
  AdminAssetCountsResponse,
  AdminLibraryStatsResponse,
  AdminReprocessThumbnailsResponse,
  FaceDetectionSettings,
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

// SCRFD-10G is the only face detector, so face runs carry no detector provenance: the record is
// the shared pipeline shape.
export type FacePipelineRun = PipelineRun
export type FaceReprocessStatus = ReprocessStatus<FacePipelineRun>
export type FaceReprocessResponse = PipelineResponse

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

/**
 * POST /v1/admin/restores response: the account rebuilt from its S3 manifest (same userId),
 * row counts plus the derivative jobs re-queued. `email` is the ACTUAL restored address —
 * when the backup-time address is taken the core falls back to a `restored-<ms>-<orig>`
 * address, so always show `email` (not the requested one). Mirrors RestoreResult in core.
 */
export interface RestoreResult extends BackupResult {
  restoredFrom: { emailAtBackup: string; prefix: string; manifestObjectKey: string }
  startedAt: string
  completedAt: string
  enqueued: { metadata: number; thumbnails: number; videos: number; faces: number; ai: number }
}

// Restores rebuild rows + copy bytes back from S3 inline, so they outlive the 10s client
// default just like backups — reuse the same cap.
export async function restoreUser(emailOrId: string): Promise<RestoreResult> {
  const { data } = await api.post<RestoreResult>(
    '/v1/admin/restores',
    { emailOrId },
    { timeout: BACKUP_TIMEOUT_MS },
  )
  return data
}

/**
 * DELETE /v1/admin/backups response: the S3 prefix removed and how many objects went
 * with it. Deletes are metadata-only, so the client's default 10s timeout is fine.
 * Mirrors DeleteBackupResult in core.
 */
export interface DeleteBackupResult {
  userId: string
  email: string
  prefix: string
  deletedObjects: number
}

export async function deleteBackup(emailOrId: string): Promise<DeleteBackupResult> {
  const { data } = await api.delete<DeleteBackupResult>('/v1/admin/backups', {
    params: { emailOrId },
  })
  return data
}

/**
 * GET /v1/admin/backups/overview response row: one line per user — library size, what the
 * manifest on S3 already covers, and whether that manifest is usable. `unavailable`
 * marks a row whose status probe failed (shown as Unavailable instead of failing the
 * whole table). `deleted` marks orphan backups whose account is gone (live counts are zero, identity
 * comes from the manifest); `emailAtBackup` is set only when the S3 prefix email differs
 * from the manifest email (stale rename leftover).
 */
export interface BackupOverviewRow {
  userId: string
  email: string
  role: 'user' | 'admin'
  totalAssets: number
  backedUpAssets: number
  backedUpFiles: number
  backedUpAt?: string | null
  exists: boolean
  degraded?: 'unreadable' | 'corrupt'
  unavailable?: boolean
  notBackedUp?: number
  deleted: boolean
  emailAtBackup?: string
}

export async function getBackupOverview(): Promise<BackupOverviewRow[]> {
  const { data } = await api.get<BackupOverviewRow[]>('/v1/admin/backups/overview', {
    timeout: BACKUP_STATUS_TIMEOUT_MS,
  })
  return data
}

// --- admin user deletion --------------------------------------------------------------
// DELETE /v1/admin/users/:id is async: the core answers 202 { jobId, userId, backupKept,
// backupPrefix } while the worker removes the account in the background. Status polls
// GET /v1/admin/users/:id/delete-status by userId (stays readable after the row is
// gone); the backend { state, ... } shape is mapped to the { status, error? }
// view-model so the dialog keeps polling on coarse lifecycles.

/** DELETE /v1/admin/users/:id response: 202 carries the background job id. */
export type AdminUserDeleteAccepted = AdminUserDeleteResponse

export async function deleteAdminUser(id: string): Promise<AdminUserDeleteAccepted> {
  const { data } = await api.delete<AdminUserDeleteAccepted>(
    `/v1/admin/users/${encodeURIComponent(id)}`,
  )
  return data
}

/** GET :id/delete-status view-model: coarse lifecycle of the background removal. */
export interface AdminUserDeleteStatus {
  status: string
  error?: string | null
}

export async function getAdminUserDeleteStatus(userId: string): Promise<AdminUserDeleteStatus> {
  const { data } = await api.get<AdminUserDeleteBackendStatus & { error?: unknown }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/delete-status`,
  )
  const error = typeof data.error === 'string' ? data.error : null
  return { status: data.state, error }
}

const DELETE_DONE = new Set(['completed'])
const DELETE_FAILED = new Set(['failed'])

/**
 * Poll the :id/delete-status endpoint until the removal lands or the budget runs out.
 * Only the core's terminal states settle the promise — anything unknown keeps polling.
 */
export async function pollAdminUserDelete(
  userId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 1000
  const timeoutMs = opts.timeoutMs ?? 60000
  const started = Date.now()
  for (;;) {
    const state = await getAdminUserDeleteStatus(userId)
    const status = state.status?.toLowerCase() ?? ''
    if (DELETE_DONE.has(status)) return
    if (DELETE_FAILED.has(status)) {
      const message = state.error ?? 'User deletion failed'
      throw new Error(message === '' ? 'User deletion failed' : message)
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error('Timed out waiting for the deletion — refresh the list to check.')
    }
    await sleep(intervalMs)
  }
}
