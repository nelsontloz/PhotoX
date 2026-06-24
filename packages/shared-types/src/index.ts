export interface User {
  id: string
  email: string
  displayName: string
  avatarUrl?: string
  createdAt: string
  updatedAt: string
}

export interface RegisterRequest {
  email: string
  password: string
  displayName: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RefreshRequest {
  refreshToken: string
}

export interface LogoutRequest {
  refreshToken: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface FileRecord {
  id: string
  userId: string
  storageKey: string
  originalName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  createdAt: string
}

export interface FileSummary {
  id: string
  userId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface FileListResponse {
  items: FileSummary[]
  total: number
  limit: number
  offset: number
}

export interface BatchFilesResponse {
  items: FileRecord[]
  missing: string[]
}

export type AssetKind = 'photo' | 'video'

export type MetadataStatus = 'pending' | 'ready' | 'failed'

export type TranscodeStatus = 'pending' | 'ready' | 'failed'

export interface Asset {
  id: string
  userId: string
  kind: AssetKind
  fileId: string
  uploadedAt: string
  isTrashed: boolean
  trashedAt: string | null
  title: string | null
  description: string | null
  takenAt: string | null
  favorite: boolean
  mimeType: string | null
  sizeBytes: number | null
  originalName: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  orientation: number | null
  iso: number | null
  fNumber: number | null
  exposureTime: number | null
  focalLength: number | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  fps: number | null
  codec: string | null
  hasAudio: boolean | null
  metadata: Record<string, unknown> | null
  metadataStatus: MetadataStatus
  metadataExtractedAt: string | null
  hlsMasterKey: string | null
  transcodeStatus: TranscodeStatus
  transcodedAt: string | null
}

export interface AssetListResponse {
  items: Asset[]
  total: number
  limit: number
  offset: number
}

export interface AssetThumbnail {
  size: string
  fileId: string
  width: number
  height: number
  bytes: number
  createdAt: string
}

export type AssetThumbnailListResponse = AssetThumbnail[]
