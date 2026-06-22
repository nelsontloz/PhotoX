import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@photox/shared-types'
import * as authApi from '../api/auth'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  status: 'idle' | 'loading' | 'authenticated' | 'error'
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      status: 'idle',
      error: null,

      login: async (email, password) => {
        set({ status: 'loading', error: null })
        try {
          const res = await authApi.login({ email, password })
          set({
            user: res.user,
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            status: 'authenticated',
          })
        } catch (err: unknown) {
          const axiosErr = err as { response?: { data?: { message?: string } } }
          const message = axiosErr.response?.data?.message ?? 'Login failed'
          set({ status: 'error', error: message })
        }
      },

      register: async (email, password, displayName) => {
        set({ status: 'loading', error: null })
        try {
          const res = await authApi.register({ email, password, displayName })
          set({
            user: res.user,
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            status: 'authenticated',
          })
        } catch (err: unknown) {
          const axiosErr = err as { response?: { data?: { message?: string } } }
          const message = axiosErr.response?.data?.message ?? 'Registration failed'
          set({ status: 'error', error: message })
        }
      },

      logout: async () => {
        const token = get().refreshToken
        if (token) {
          await authApi.logout(token).catch(() => {
            /* noop */
          })
        }
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          status: 'idle',
          error: null,
        })
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'photox.auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      merge: (persisted, current) => {
        const data = persisted as Partial<AuthState>
        return {
          ...current,
          ...data,
          status: data.accessToken ? 'authenticated' : 'idle',
        }
      },
    },
  ),
)
