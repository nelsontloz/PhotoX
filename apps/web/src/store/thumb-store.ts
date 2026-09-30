import { create } from 'zustand'

interface ThumbState {
  urls: Record<string, string>
  set: (fileId: string, url: string) => void
}

export const useThumbStore = create<ThumbState>((set) => ({
  urls: {},

  set: (fileId, url) =>
    set((s) => {
      const prev = s.urls[fileId]
      if (prev && prev !== url) URL.revokeObjectURL(prev)
      return { urls: { ...s.urls, [fileId]: url } }
    }),
}))
