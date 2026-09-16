import type { FileRecord } from '@photox/data-access'

export function toFileRecordResponse(record: FileRecord) {
  return {
    id: record.id,
    userId: record.userId,
    storageKey: record.storageKey,
    originalName: record.originalName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    checksumSha256: record.checksumSha256,
    purpose: record.purpose,
    assetId: record.assetId,
    createdAt: record.createdAt.toISOString(),
  }
}
