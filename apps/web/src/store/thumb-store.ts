import { create } from 'zustand'

interface ThumbState {
  urls: Record<string, string>
  set: (fileId: string, url: string) => void
  get: (fileId: string) => string | undefined
}

export const useThumbStore = create<ThumbState>((set, get) => ({
  urls: {},

  set: (fileId, url) =>
    set((s) => {
      const prev = s.urls[fileId]
      if (prev && prev !== url) URL.revokeObjectURL(prev)
      return { urls: { ...s.urls, [fileId]: url } }
    }),

  get: (fileId) => get().urls[fileId],
}))
