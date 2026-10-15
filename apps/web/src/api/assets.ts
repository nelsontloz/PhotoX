import { api } from './client'
import type {
  Asset,
  AssetLayout,
  AssetListResponse,
  AssetDetectionsResponse,
  FileExistsCheckHit,
  FileExistsCheckItem,
  FileExistsCheckResponse,
  SearchResponse,
} from '@photox/shared-types'

interface ListAssetsParams {
  limit?: number
  offset?: number
  isTrashed?: boolean
  favorite?: boolean
  hasLocations?: boolean
  // half-open range on COALESCE(takenAt, uploadedAt) — the timeline's per-month window
  dateFrom?: string
  dateTo?: string
  /** Restricts to one person's assets (person detail grid) */
  personId?: string
  /** Restricts to one album's assets (album detail grid) */
  albumId?: string
}

/** Asset-list/layout filters shared by the timeline-backed views (home, favorites, person, album). */
export interface AssetFilters {
  personId?: string
  favorite?: boolean
  albumId?: string
}

export async function listAssets(params: ListAssetsParams = {}): Promise<AssetListResponse> {
  const { isTrashed, ...rest } = params
  if (isTrashed) {
    const { data } = await api.get<AssetListResponse>('/v1/assets/trashed', { params: rest })
    return data
  }
  const { data } = await api.get<AssetListResponse>('/v1/assets', { params: rest })
  return data
}

/**
 * Fetches page 1 (offset 0) serially, then all remaining pages in parallel. `limit` is the page
 * size, not a cap; an empty first page returns [].
 */
export async function listAllAssets(params: ListAssetsParams = {}): Promise<Asset[]> {
  const limit = params.limit ?? 100
  const first = await listAssets({ ...params, limit, offset: 0 })
  const all = [...first.items]
  if (first.items.length === 0 || all.length >= first.total) return all
  const pages: Promise<AssetListResponse>[] = []
  // ponytail: all remaining pages fire at once; the browser/HTTP stack caps concurrency.
  // Cap + retry if a single month ever exceeds a few thousand rows.
  for (let offset = limit; offset < first.total; offset += limit) {
    pages.push(listAssets({ ...params, limit, offset }))
  }
  for (const page of await Promise.all(pages)) all.push(...page.items)
  return all
}

export async function getAsset(assetId: string): Promise<Asset> {
  const { data } = await api.get<Asset>(`/v1/assets/${assetId}`)
  return data
}

export async function getAssetLayout(filters: AssetFilters = {}): Promise<AssetLayout> {
  const { data } = await api.get<AssetLayout>('/v1/assets/layout', { params: filters })
  return data
}

/**
 * HEADs the download route first so the axios refresh/401-retry interceptors run and auth or
 * missing-file errors throw here — the caller then skips the anchor click instead of the tab
 * navigating to a JSON error page mid-download.
 */
export async function preflightFileDownload(fileId: string): Promise<void> {
  await api.head(`/v1/files/${fileId}/download`)
}

/**
 * Same-origin URL the browser downloads natively: bytes stream straight to disk (no Blob in
 * memory) and the server already sets the filename via Content-Disposition.
 */
export function getFileDownloadUrl(fileId: string): string {
  return `/api/v1/files/${fileId}/download`
}

/**
 * Same-origin URL for direct <img>/<video> use: the browser attaches the auth cookie itself,
 * which axios can't do for those tags (it sends no headers there at all).
 */
export function getFileStreamUrl(fileId: string): string {
  return `/api/v1/files/${fileId}/stream`
}

export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void,
  kind?: 'photo' | 'video',
  title?: string,
  description?: string,
  takenAt?: string,
): Promise<Asset> {
  const formData = new FormData()
  formData.append('file', file)
  if (kind) formData.append('kind', kind)
  if (title) formData.append('title', title)
  if (description) formData.append('description', description)
  if (takenAt) formData.append('takenAt', takenAt)

  const { data } = await api.post<Asset>('/v1/files', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 3_600_000,
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    },
  })
  return data
}

export async function updateAsset(
  id: string,
  body: { favorite?: boolean; title?: string; description?: string; takenAt?: string },
): Promise<Asset> {
  const { data } = await api.patch<Asset>(`/v1/assets/${id}`, body)
  return data
}

export async function trashAsset(assetId: string): Promise<void> {
  await api.post(`/v1/assets/${assetId}/trash`)
}

export async function restoreAsset(assetId: string): Promise<void> {
  await api.post(`/v1/assets/trashed/${assetId}/restore`)
}

export async function deleteAsset(assetId: string): Promise<void> {
  await api.delete(`/v1/assets/trashed/${assetId}`)
}

export async function emptyTrash(): Promise<void> {
  await api.delete('/v1/assets/trashed')
}

export async function reprocessThumbnails(assetId: string): Promise<void> {
  await api.post(`/v1/assets/${assetId}/reprocess-thumbnails`)
}

export async function reprocessVideo(assetId: string): Promise<void> {
  await api.post(`/v1/assets/${assetId}/reprocess-video`)
}

export async function trashAssets(assetIds: string[]): Promise<void> {
  await api.post('/v1/assets/bulk-trash', { assetIds })
}

interface SearchParams {
  q: string
  limit?: number
  offset?: number
}

export async function searchAssets(params: SearchParams): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>('/v1/search', { params })
  return data
}

/** Visually similar assets (image-embedding ANN). Server default limit 12, max 100. */
export async function getSimilarAssets(assetId: string): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>(`/v1/assets/${assetId}/similar`)
  return data
}

/** Perceptual duplicates within the Hamming threshold. Server default 10, max 64. */
export async function getAssetDuplicates(assetId: string): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>(`/v1/assets/${assetId}/duplicates`)
  return data
}

export async function getAssetDetections(assetId: string): Promise<AssetDetectionsResponse> {
  const { data } = await api.get<AssetDetectionsResponse>(`/v1/assets/${assetId}/detections`)
  return data
}

/** Exists-check budget: a stalled check throws, and the caller fail-open uploads. */
export const CHECK_FILES_EXIST_TIMEOUT_MS = 20_000

export async function checkFilesExist(
  items: FileExistsCheckItem[],
  options: { timeout?: number } = {},
): Promise<FileExistsCheckHit[]> {
  const { data } = await api.post<FileExistsCheckResponse>(
    '/v1/files/exists',
    {
      items,
    },
    { timeout: options.timeout ?? CHECK_FILES_EXIST_TIMEOUT_MS },
  )
  return data.items
}
