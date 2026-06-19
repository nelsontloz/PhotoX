import { create } from 'zustand'

interface AppState {
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
}))
