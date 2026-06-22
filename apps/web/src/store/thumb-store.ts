import { create } from 'zustand'

interface ThumbState {
  urls: Record<string, string>
  set: (fileId: string, url: string) => void
  get: (fileId: string) => string | undefined
  clear: () => void
}

export const useThumbStore = create<ThumbState>((set, get) => ({
  urls: {},

  set: (fileId, url) =>
    set((s) => ({
      urls: { ...s.urls, [fileId]: url },
    })),

  get: (fileId) => get().urls[fileId],

  clear: () => set({ urls: {} }),
}))
