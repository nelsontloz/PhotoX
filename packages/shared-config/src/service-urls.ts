export const SERVICE_URLS = {
  'user-service': process.env.USER_SERVICE_URL ?? 'http://localhost:3001',
  'media-service': process.env.MEDIA_SERVICE_URL ?? 'http://localhost:3002',
  'file-storage-service': process.env.FILE_STORAGE_SERVICE_URL ?? 'http://localhost:3003',
} as const
