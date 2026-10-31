import { create } from 'zustand'

export type UploadStatus = 'queued' | 'hashing' | 'uploading' | 'done' | 'error'

export interface UploadItem {
  id: string
  fileName: string
  sizeBytes: number
  kind: 'photo' | 'video'
  progress: number
  status: UploadStatus
  error?: string
  localThumbUrl?: string
}

interface UploadState {
  items: UploadItem[]
  dismissed: boolean
  enqueue: (files: File[]) => void
  setProgress: (id: string, pct: number) => void
  setStatus: (id: string, status: UploadStatus, patch?: Partial<UploadItem>) => void
  setDismissed: (b: boolean) => void
  clearDone: () => void
}

let nextId = 0
function makeId(): string {
  return `upload-${++nextId}-${Date.now()}`
}

function fileKind(file: File): 'photo' | 'video' {
  return file.type.startsWith('video/') ? 'video' : 'photo'
}

// The File objects live in an in-memory ref (lib/upload), so nothing here survives a reload:
// a queued row without its File can never be retried, hence no persistence middleware.
export const useUploadStore = create<UploadState>()((set) => ({
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

  clearDone: () =>
    set((s) => ({
      items: s.items.filter((i) => i.status !== 'done' && i.status !== 'error'),
    })),
}))
