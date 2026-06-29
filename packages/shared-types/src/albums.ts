export interface AlbumDto {
  id: string
  userId: string
  name: string
  description: string | null
  assetCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateAlbumDto {
  name: string
  description?: string
}

export interface UpdateAlbumDto {
  name?: string
  description?: string
}

export interface AddAssetsToAlbumDto {
  assetIds: string[]
}

export interface ListAlbumsQueryDto {
  userId: string
  limit?: number
  offset?: number
}
