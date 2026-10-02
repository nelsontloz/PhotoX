// ponytail: module-level LRU over object URLs with entry + byte caps (blob URLs pin memory for as
// long as they exist). No refcounting, so evicting an entry that is still on screen can flicker;
// add refcounts only if that ever actually happens.
export const BLOB_CACHE_MAX_ENTRIES = 400
export const BLOB_CACHE_MAX_BYTES = 256 * 1024 * 1024

interface BlobCacheEntry {
  promise: Promise<string>
  url?: string
  bytes: number
}

const entries = new Map<string, BlobCacheEntry>()
let totalBytes = 0

function evictOverflow(): void {
  if (entries.size <= BLOB_CACHE_MAX_ENTRIES && totalBytes <= BLOB_CACHE_MAX_BYTES) return
  // Map iterates in insertion order (oldest first). Entries still in flight are skipped: their
  // consumer is waiting on the promise, only the resolved URL costs memory.
  for (const [key, entry] of entries) {
    if (entries.size <= 1) break
    if (entries.size <= BLOB_CACHE_MAX_ENTRIES && totalBytes <= BLOB_CACHE_MAX_BYTES) break
    if (entry.url === undefined) continue
    entries.delete(key)
    URL.revokeObjectURL(entry.url)
    totalBytes -= entry.bytes
  }
}

export function getCachedBlobUrl(key: string, fetcher: () => Promise<Blob>): Promise<string> {
  const cached = entries.get(key)
  if (cached) {
    entries.delete(key)
    entries.set(key, cached)
    return cached.url !== undefined ? Promise.resolve(cached.url) : cached.promise
  }

  const entry = { bytes: 0 } as BlobCacheEntry
  entry.promise = fetcher()
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      entry.url = url
      entry.bytes = blob.size
      totalBytes += blob.size
      evictOverflow()
      return url
    })
    .catch((err: unknown) => {
      // Drop the failed entry so the next caller retries instead of replaying the rejection.
      if (entries.get(key) === entry) {
        entries.delete(key)
        totalBytes -= entry.bytes
      }
      throw err
    })
  entries.set(key, entry)
  return entry.promise
}

export function peekCachedBlobUrl(key: string): string | undefined {
  const entry = entries.get(key)
  if (entry?.url === undefined) return undefined
  entries.delete(key)
  entries.set(key, entry)
  return entry.url
}

export function clearBlobCache(): void {
  for (const entry of entries.values()) {
    if (entry.url !== undefined) URL.revokeObjectURL(entry.url)
  }
  entries.clear()
  totalBytes = 0
}
