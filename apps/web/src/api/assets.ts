import { api } from './client'
import type { AssetListResponse, AssetThumbnailListResponse } from '@photox/shared-types'

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
