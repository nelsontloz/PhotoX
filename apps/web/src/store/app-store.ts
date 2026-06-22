import { create } from 'zustand'

interface AppState {
  theme: 'dark' | 'light'
  toggleTheme: () => void
  timelineRefreshKey: number
  bumpTimelineRefresh: () => void
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  timelineRefreshKey: 0,
  bumpTimelineRefresh: () => set((s) => ({ timelineRefreshKey: s.timelineRefreshKey + 1 })),
}))
