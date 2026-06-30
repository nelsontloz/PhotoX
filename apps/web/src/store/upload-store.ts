import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error'

export interface UploadItem {
  id: string
  fileName: string
  sizeBytes: number
  kind: 'photo' | 'video'
  progress: number
  status: UploadStatus
  assetId?: string
  fileId?: string
  error?: string
  localThumbUrl?: string
}

interface PersistedItem {
  id: string
  fileName: string
  sizeBytes: number
  kind: 'photo' | 'video'
  progress: number
  status: UploadStatus
  assetId?: string
  fileId?: string
  error?: string
}

function partializeItem(item: UploadItem): PersistedItem {
  if (item.status === 'uploading' || item.status === 'queued') {
    return {
      id: item.id,
      fileName: item.fileName,
      sizeBytes: item.sizeBytes,
      kind: item.kind,
      progress: 0,
      status: 'error',
      error: 'Interrupted by reload — please retry',
    }
  }
  const out: PersistedItem = {
    id: item.id,
    fileName: item.fileName,
    sizeBytes: item.sizeBytes,
    kind: item.kind,
    progress: item.progress,
    status: item.status,
  }
  if (item.assetId !== undefined) out.assetId = item.assetId
  if (item.fileId !== undefined) out.fileId = item.fileId
  if (item.error !== undefined) out.error = item.error
  return out
}

interface UploadState {
  items: UploadItem[]
  dismissed: boolean
  enqueue: (files: File[]) => void
  setProgress: (id: string, pct: number) => void
  setStatus: (id: string, status: UploadStatus, patch?: Partial<UploadItem>) => void
  setDismissed: (b: boolean) => void
  clearDone: () => void
  clearAll: () => void
}

let nextId = 0
function makeId(): string {
  return `upload-${++nextId}-${Date.now()}`
}

function fileKind(file: File): 'photo' | 'video' {
  return file.type.startsWith('video/') ? 'video' : 'photo'
}

export const useUploadStore = create<UploadState>()(
  persist(
    (set) => ({
      items: [],
      dismissed: false,

      enqueue: (files) =>
        set((s) => ({
          dismissed: false,
          items: [
            ...s.items,
            ...files.map((file) => ({
              id: makeId(),
              fileName: file.name,
              sizeBytes: file.size,
              kind: fileKind(file),
              progress: 0,
              status: 'queued' as const,
            })),
          ],
        })),

      setProgress: (id, pct) =>
        set((s) => ({
          items: s.items.map((item) => (item.id === id ? { ...item, progress: pct } : item)),
        })),

      setStatus: (id, status, patch) =>
        set((s) => ({
          items: s.items.map((item) => (item.id === id ? { ...item, status, ...patch } : item)),
        })),

      setDismissed: (b) => set({ dismissed: b }),

      clearDone: () => set((s) => ({ items: s.items.filter((i) => i.status !== 'done') })),

      clearAll: () => set({ items: [] }),
    }),
    {
      name: 'photox.upload-queue.v1',
      version: 1,
      partialize: (state) => ({
        items: state.items.map(partializeItem),
        dismissed: state.dismissed,
      }),
    },
  ),
)
