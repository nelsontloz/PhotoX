import { api } from './client'
import type { Asset, AssetLayout, AssetListResponse } from '@photox/shared-types'

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

export async function getAssetLayout(personId?: string): Promise<AssetLayout> {
  const { data } = await api.get<AssetLayout>('/v1/assets/layout', { params: { personId } })
  return data
}

export async function downloadFile(fileId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/v1/files/${fileId}/download`, {
    responseType: 'blob',
    timeout: 300_000,
  })
  return data
}

/**
 * Same-origin URL for direct <img>/<video> use: the browser attaches the auth cookie itself, which
 * the axios client's Bearer header pipeline can't for those tags.
 */
export function getFileStreamUrl(fileId: string): string {
  return `/api/v1/files/${fileId}/stream`
}

export function getVideoStreamUrl(fileId: string): string {
  return getFileStreamUrl(fileId)
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
