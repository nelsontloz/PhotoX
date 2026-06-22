import { create } from 'zustand'

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

interface UploadState {
  items: UploadItem[]
  enqueue: (files: File[]) => void
  setProgress: (id: string, pct: number) => void
  setStatus: (id: string, status: UploadStatus, patch?: Partial<UploadItem>) => void
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

export const useUploadStore = create<UploadState>((set) => ({
  items: [],

  enqueue: (files) =>
    set((s) => ({
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

  clearDone: () => set((s) => ({ items: s.items.filter((i) => i.status !== 'done') })),

  clearAll: () => set({ items: [] }),
}))
