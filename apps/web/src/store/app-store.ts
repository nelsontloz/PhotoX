import { create } from 'zustand'

interface AppState {
  timelineRefreshKey: number
  bumpTimelineRefresh: () => void
}

export const useAppStore = create<AppState>((set) => ({
  timelineRefreshKey: 0,
  bumpTimelineRefresh: () => set((s) => ({ timelineRefreshKey: s.timelineRefreshKey + 1 })),
}))
