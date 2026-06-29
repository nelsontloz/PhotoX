import { api } from './client'
import type {
  AlbumDto,
  CreateAlbumDto,
  UpdateAlbumDto,
  AddAssetsToAlbumDto,
} from '@photox/shared-types'
import type { Asset } from '@photox/shared-types'

interface ListAlbumsParams {
  limit?: number
  offset?: number
}

interface ListAlbumAssetsParams {
  limit?: number
  offset?: number
}

export async function listAlbums(
  params: ListAlbumsParams = {},
): Promise<{ items: AlbumDto[]; total: number }> {
  const { data } = await api.get<{ items: AlbumDto[]; total: number }>('/v1/albums', { params })
  return data
}

export async function getAlbum(id: string): Promise<AlbumDto> {
  const { data } = await api.get<AlbumDto>(`/v1/albums/${id}`)
  return data
}

export async function createAlbum(body: CreateAlbumDto): Promise<AlbumDto> {
  const { data } = await api.post<AlbumDto>('/v1/albums', body)
  return data
}

export async function updateAlbum(id: string, body: UpdateAlbumDto): Promise<AlbumDto> {
  const { data } = await api.patch<AlbumDto>(`/v1/albums/${id}`, body)
  return data
}

export async function deleteAlbum(id: string): Promise<void> {
  await api.delete(`/v1/albums/${id}`)
}

export async function listAlbumAssets(
  id: string,
  params: ListAlbumAssetsParams = {},
): Promise<{ items: Asset[]; total: number }> {
  const { data } = await api.get<{ items: Asset[]; total: number }>(`/v1/albums/${id}/assets`, {
    params,
  })
  return data
}

export async function addAssetsToAlbum(id: string, assetIds: string[]): Promise<{ added: number }> {
  const body: AddAssetsToAlbumDto = { assetIds }
  const { data } = await api.post<{ added: number }>(`/v1/albums/${id}/assets`, body)
  return data
}

export async function removeAssetFromAlbum(id: string, assetId: string): Promise<void> {
  await api.delete(`/v1/albums/${id}/assets/${assetId}`)
}
