import { useUploadStore, type UploadItem } from '../store/upload-store'

const STORAGE_KEY = 'photox.upload-queue.v1'

interface SerializedUploadItem {
  id: string
  fileName: string
  sizeBytes: number
  kind: 'photo' | 'video'
  progress: number
  status: 'queued' | 'uploading' | 'done' | 'error'
  assetId?: string
  fileId?: string
  error?: string
}

const VALID_STATUSES = new Set<string>(['queued', 'uploading', 'done', 'error'])
const VALID_KINDS = new Set<string>(['photo', 'video'])

function safeString(val: unknown): string {
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  return ''
}

function safeNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = Number(val)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export function serialize(items: UploadItem[]): SerializedUploadItem[] {
  return items.map((item) => {
    if (item.status === 'uploading' || item.status === 'queued') {
      return {
        id: item.id,
        fileName: item.fileName,
        sizeBytes: item.sizeBytes,
        kind: item.kind,
        progress: 0,
        status: 'error' as const,
        error: 'Interrupted by reload — please retry',
      }
    }

    const serialized: SerializedUploadItem = {
      id: item.id,
      fileName: item.fileName,
      sizeBytes: item.sizeBytes,
      kind: item.kind,
      progress: item.progress,
      status: item.status,
    }
    if (item.assetId !== undefined) serialized.assetId = item.assetId
    if (item.fileId !== undefined) serialized.fileId = item.fileId
    if (item.error !== undefined) serialized.error = item.error
    return serialized
  })
}

export function deserialize(raw: unknown): UploadItem[] {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    !('v' in raw) ||
    !('items' in raw) ||
    !Array.isArray((raw as Record<string, unknown>).items)
  ) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      void 0
    }
    return []
  }

  if ((raw as Record<string, unknown>).v !== 1) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      void 0
    }
    return []
  }

  const items = (raw as Record<string, unknown>).items as unknown[]
  const result: UploadItem[] = []

  for (const rawItem of items) {
    if (rawItem === null || typeof rawItem !== 'object') continue

    const obj = rawItem as Record<string, unknown>
    const status = safeString(obj.status)

    if (!VALID_STATUSES.has(status)) continue

    const kind = safeString(obj.kind)
    if (!VALID_KINDS.has(kind)) continue

    const item: UploadItem = {
      id: safeString(obj.id),
      fileName: safeString(obj.fileName),
      sizeBytes: safeNumber(obj.sizeBytes),
      kind: kind as 'photo' | 'video',
      progress: safeNumber(obj.progress),
      status: status as UploadItem['status'],
    }
    if (typeof obj.assetId === 'string') item.assetId = obj.assetId
    if (typeof obj.fileId === 'string') item.fileId = obj.fileId
    if (typeof obj.error === 'string') item.error = obj.error
    result.push(item)
  }

  return result
}

export function bootstrapUploadPersistence(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown
      const items = deserialize(parsed)
      const dismissed =
        typeof (parsed as Record<string, unknown>).dismissed === 'boolean'
          ? ((parsed as Record<string, unknown>).dismissed as boolean)
          : false
      useUploadStore.setState({ items, dismissed })
    }
  } catch (err) {
    console.warn('Failed to restore upload queue:', err)
  }

  let lastFingerprint =
    useUploadStore
      .getState()
      .items.map((i) => `${i.id}:${i.status}:${i.status === 'error' ? (i.error ?? '') : ''}`)
      .join('|') + `|d:${useUploadStore.getState().dismissed}`

  useUploadStore.subscribe((state) => {
    const fp =
      state.items
        .map((i) => `${i.id}:${i.status}:${i.status === 'error' ? (i.error ?? '') : ''}`)
        .join('|') + `|d:${state.dismissed}`
    if (fp !== lastFingerprint) {
      lastFingerprint = fp
      try {
        const serialized = serialize(state.items)
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ v: 1, items: serialized, dismissed: state.dismissed }),
        )
      } catch (err) {
        console.warn('Failed to persist upload queue:', err)
      }
    }
  })
}
