export const EVENTS = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  FILE_UPLOADED: 'file.uploaded',
  FILE_PROCESSED: 'file.processed',
  FILE_DELETED: 'file.deleted',
} as const

export type EventType = (typeof EVENTS)[keyof typeof EVENTS]

export interface UserCreatedEvent {
  userId: string
  email: string
  displayName: string
  timestamp: string
}

export interface UserUpdatedEvent {
  userId: string
  timestamp: string
}

export interface UserDeletedEvent {
  userId: string
  timestamp: string
}

export interface FileUploadedEvent {
  fileId: string
  userId: string
  mimeType: string
  sizeBytes: number
  timestamp: string
}

export interface FileProcessedEvent {
  fileId: string
  userId: string
  width: number
  height: number
  takenAt?: string
  thumbnails: ThumbnailInfo[]
  timestamp: string
}

export interface ThumbnailInfo {
  variant: 'sm' | 'md' | 'lg'
  storageKey: string
  width: number
  height: number
}

export interface FileDeletedEvent {
  fileId: string
  userId: string
  timestamp: string
}
