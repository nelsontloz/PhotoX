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
