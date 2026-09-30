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

/** Pages `listAssets` until `total` is covered. `limit` is the page size, not a cap. */
export async function listAllAssets(params: ListAssetsParams = {}): Promise<Asset[]> {
  const limit = params.limit ?? 100
  const all: Asset[] = []
  let offset = 0
  let total = 0
  do {
    const res = await listAssets({ ...params, limit, offset })
    all.push(...res.items)
    total = res.total
    offset += limit
    if (res.items.length === 0) break
  } while (offset < total)
  return all
}

export async function getAsset(assetId: string): Promise<Asset> {
  const { data } = await api.get<Asset>(`/v1/assets/${assetId}`)
  return data
}

export async function getAssetLayout(): Promise<AssetLayout> {
  const { data } = await api.get<AssetLayout>('/v1/assets/layout')
  return data
}

export async function downloadFile(fileId: string, signal?: AbortSignal): Promise<Blob> {
  const { data } = await api.get<Blob>(`/v1/files/${fileId}/download`, {
    responseType: 'blob',
    signal,
    timeout: 300_000,
  })
  return data
}

export function getVideoStreamUrl(fileId: string, userId: string): string {
  const params = new URLSearchParams({ userId })
  return `/api/v1/files/${fileId}/stream?${params.toString()}`
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
