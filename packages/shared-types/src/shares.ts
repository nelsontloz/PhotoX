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

/** Owner share row as listed: the capability is never included — raw tokens appear only
 *  in create responses, so a copied list token can never be mistaken for a working link. */
export type ShareListItem = Omit<AssetShareDto, 'token'> | Omit<AlbumShareDto, 'token'>

/** Anonymous public projection: kind + lifecycle only, no ids or hashes. */
export interface PublicShareInfo {
  kind: 'asset' | 'album'
  createdAt: string
  expiresAt: string | null
}

/** Exactly one of assetId / albumId must be provided. */
export interface CreateShareRequest {
  assetId?: string
  albumId?: string
}

export interface ShareListResponse {
  items: ShareListItem[]
}

/** EXIF-safe asset projection used by public share endpoints (no GPS/faces/metadata blobs,
 *  no internal ids — the stream endpoints resolve files server-side from the token). */
export interface PublicShareAsset {
  id: string
  kind: 'photo' | 'video'
  /** True when the worker transcoded the video to browser-playable AV1/webm; share streams serve it instead of the original. */
  hasTranscode: boolean
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
  share: PublicShareInfo
  asset: PublicShareAsset
}

export interface PublicAlbumShareResponse {
  kind: 'album'
  share: PublicShareInfo
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
