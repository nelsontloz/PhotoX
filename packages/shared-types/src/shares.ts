export interface AssetShareDto {
  id: string
  assetId: string
  userId: string
  token: string
  assetFileId: string | null
  assetThumbFileId: string | null
  assetKind: 'photo' | 'video' | null
  createdAt: string
}

export interface CreateShareRequest {
  assetId: string
}

export interface ShareListResponse {
  items: AssetShareDto[]
}

export interface PublicShareResponse {
  share: AssetShareDto
  asset: {
    id: string
    userId: string
    kind: 'photo' | 'video'
    fileId: string
    title: string | null
    originalName: string | null
    mimeType: string | null
    width: number | null
    height: number | null
    durationSeconds: number | null
    takenAt: string | null
  }
}
