import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@photox/shared-types'
import type { AuthResponse } from '@photox/shared-types'
import * as authApi from '../api/auth'
import { jwtDecode } from 'jwt-decode'
import { registerAuthAccess } from '../lib/authToken'
import type { JwtPayload } from '@photox/shared-auth'

const REFRESH_LEAD_MS = 5 * 60 * 1000
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshInFlight: Promise<AuthResponse> | null = null
const authFailureListeners = new Set<() => void>()

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  status: 'idle' | 'loading' | 'authenticated' | 'error'
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
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

      refresh: async () => {
        const rt = get().refreshToken
        if (!rt) return

        if (refreshInFlight) {
          await refreshInFlight.catch(() => {
            // ignore — caller handles error via the auth-failure listener
          })
          return
        }

        try {
          const promise = authApi.refresh(rt)
          refreshInFlight = promise
          const res = await promise
          set({
            user: res.user,
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            status: 'authenticated',
          })
        } catch {
          await get().logout()
          authFailureListeners.forEach((cb) => cb())
        } finally {
          refreshInFlight = null
        }
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

function scheduleRefresh(accessToken: string | null) {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  if (!accessToken) return

  let exp: number | null = null
  try {
    const payload = jwtDecode<JwtPayload>(accessToken)
    if (typeof payload.exp === 'number') exp = payload.exp
  } catch {
    /* invalid token */
  }
  if (exp === null) return

  const delay = exp * 1000 - Date.now() - REFRESH_LEAD_MS
  if (delay <= 0) {
    void useAuthStore.getState().refresh()
    return
  }

  refreshTimer = setTimeout(() => {
    void useAuthStore.getState().refresh()
  }, delay)
}

useAuthStore.subscribe((state) => {
  scheduleRefresh(state.accessToken)
})

export function subscribeAuthFailure(cb: () => void): () => void {
  authFailureListeners.add(cb)
  return () => {
    authFailureListeners.delete(cb)
  }
}

registerAuthAccess(
  () => useAuthStore.getState().accessToken,
  () => useAuthStore.getState().refresh(),
)
