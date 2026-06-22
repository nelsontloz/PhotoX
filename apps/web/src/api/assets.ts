import { api } from './client'
import type { Asset, AssetListResponse, AssetThumbnailListResponse, FileRecord } from '@photox/shared-types'

interface ListAssetsParams {
  limit?: number
  offset?: number
  kind?: 'photo' | 'video'
}

export async function listAssets(params: ListAssetsParams = {}): Promise<AssetListResponse> {
  const { data } = await api.get<AssetListResponse>('/v1/assets', { params })
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

export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<FileRecord> {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await api.post<FileRecord>('/v1/files', formData, {
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
