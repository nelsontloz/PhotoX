export type ShareKind = 'asset' | 'album'

export interface AssetShareDto {
  id: string
  kind: 'asset'
  userId: string
  token: string
  assetId: string
  assetFileId: string | null
  assetThumbFileId: string | null
  assetKind: 'photo' | 'video' | null
  createdAt: string
}

export interface AlbumShareDto {
  id: string
  kind: 'album'
  userId: string
  token: string
  albumId: string
  albumName: string
  albumAssetCount: number
  albumCoverThumbFileId: string | null
  createdAt: string
}

export type ShareDto = AssetShareDto | AlbumShareDto

/** Exactly one of assetId / albumId must be provided. */
export interface CreateShareRequest {
  assetId?: string
  albumId?: string
}

export interface ShareListResponse {
  items: ShareDto[]
}

/** EXIF-safe asset projection used by public share endpoints (no GPS/faces/metadata blobs). */
export interface PublicShareAsset {
  id: string
  userId: string
  kind: 'photo' | 'video'
  fileId: string
  /** Set when the worker transcoded the video to browser-playable AV1/webm; share streams serve it instead of the original. */
  transcodeFileId: string | null
  title: string | null
  originalName: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  takenAt: string | null
}

export interface PublicAssetShareResponse {
  kind: 'asset'
  share: AssetShareDto
  asset: PublicShareAsset
}

export interface PublicAlbumShareResponse {
  kind: 'album'
  share: AlbumShareDto
  album: {
    id: string
    name: string
    description: string | null
    assetCount: number
  }
}

export type PublicShareResponse = PublicAssetShareResponse | PublicAlbumShareResponse

export interface PublicAlbumAssetsResponse {
  items: PublicShareAsset[]
}
