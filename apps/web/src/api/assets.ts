import { api } from './client'
import type { Asset, AssetListResponse, AssetThumbnailListResponse } from '@photox/shared-types'

interface ListAssetsParams {
  limit?: number
  offset?: number
  kind?: 'photo' | 'video'
}

export async function listAssets(params: ListAssetsParams = {}): Promise<AssetListResponse> {
  const { data } = await api.get<AssetListResponse>('/v1/assets', { params })
  return data
}

export async function getAsset(assetId: string): Promise<Asset> {
  const { data } = await api.get<Asset>(`/v1/assets/${assetId}`)
  return data
}

export async function listThumbnails(assetId: string): Promise<AssetThumbnailListResponse> {
  const { data } = await api.get<AssetThumbnailListResponse>(`/v1/assets/${assetId}/thumbnails`)
  return data
}

export async function downloadFile(fileId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/v1/files/${fileId}/download`, {
    responseType: 'blob',
  })
  return data
}

/**
 * The /api/v1/videos/* routes are gateway-authenticated. The browser must
 * send `Authorization: Bearer <accessToken>` on every request (manifest +
 * every segment + the original stream fallback). hls.js does this via its
 * `xhrSetup` hook in VideoPlayer; the axios-based fallback passes the header
 * directly. These URL helpers just build paths; auth is the caller's job.
 */
export function getVideoStreamUrl(assetId: string, userId: string): string {
  const params = new URLSearchParams({ userId })
  return `/api/v1/videos/${assetId}/stream?${params.toString()}`
}

export function getHlsPlaylistUrl(assetId: string): string {
  return `/api/v1/videos/${assetId}/playlist.m3u8`
}

export function getHlsSegmentUrl(assetId: string, segmentPath: string): string {
  const trimmed = segmentPath.replace(/^\/+/, '')
  return `/api/v1/videos/${assetId}/${trimmed}`
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
    timeout: 180_000,
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    },
  })
  return data
}

interface CreateAssetParams {
  fileId: string
  kind: 'photo' | 'video'
  title?: string
  description?: string
  takenAt?: string
}

export async function createAsset(params: CreateAssetParams): Promise<Asset> {
  const { data } = await api.post<Asset>('/v1/assets', params)
  return data
}
