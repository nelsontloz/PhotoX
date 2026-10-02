import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User, AuthResponse, JwtPayload } from '@photox/shared-types'
import * as authApi from '../api/auth'

const AUTH_STORAGE_KEY = 'photox.auth'
const REFRESH_LEAD_MS = 5 * 60 * 1000
// ponytail: exactly one transient retry — server rotates single-use tokens, so more
// attempts would mostly increase the chance of racing a lost response.
const TRANSIENT_RETRY_DELAY_MS = 1000

let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshInFlight: Promise<void> | null = null
// bumped by logout/clear paths; an in-flight refresh whose epoch no longer matches is a zombie
let sessionEpoch = 0
const authFailureListeners = new Set<() => void>()

// jwt payloads are base64url — atob needs the url-safe chars swapped back
function decodeJwtPayload(token: string): JwtPayload {
  const part = token.split('.')[1]
  if (!part) throw new Error('malformed JWT')
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as JwtPayload
}

// definitive = the server rejected the credentials (4xx). No response, timeouts,
// 5xx, 408 and 429 are transient and get one quiet retry before surfacing.
function isDefinitiveAuthFailure(err: unknown): boolean {
  const status = (err as { response?: { status?: number } }).response?.status
  if (typeof status !== 'number') return false
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

// malformed / missing exp counts as expiring — refreshing is the safe response
export function isExpiringSoon(token: string | null, leadMs = REFRESH_LEAD_MS): boolean {
  if (!token) return true
  try {
    const payload = decodeJwtPayload(token)
    if (typeof payload.exp !== 'number') return true
    return payload.exp * 1000 - Date.now() <= leadMs
  } catch {
    return true
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface PersistedAuth {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
}

// localStorage is untrusted and zustand wraps state in `{ state, version }` — parse defensively.
function readPersistedAuth(): PersistedAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: Partial<PersistedAuth> }
    const state = parsed?.state
    if (typeof state?.refreshToken !== 'string' || state.refreshToken === '') return null
    return {
      user: state.user ?? null,
      accessToken: state.accessToken ?? null,
      refreshToken: state.refreshToken,
    }
  } catch {
    return null
  }
}

// ponytail: BroadcastChannel-only cross-tab signalling — storage-event fallback only if
// browsers without BroadcastChannel support ever matter.
const authChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('photox.auth') : null

function broadcastAuth(message: { type: 'tokens' } | { type: 'logout' }) {
  authChannel?.postMessage(message)
}

// Web Locks are cross-tab: serialises rotation so single-use refresh tokens are not raced
// between tabs. ponytail: direct call fallback — jsdom and old browsers lack navigator.locks.
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn()
  const result = (await navigator.locks.request('photox.auth.refresh', () => fn())) as T
  return result
}

async function refreshWithRetry(rt: string): Promise<AuthResponse> {
  try {
    return await authApi.refresh(rt)
  } catch (err: unknown) {
    if (isDefinitiveAuthFailure(err)) throw err
    await sleep(TRANSIENT_RETRY_DELAY_MS)
    return authApi.refresh(rt)
  }
}

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

      logout: () => {
        const token = get().refreshToken
        sessionEpoch++
        // clear locally first: logout must never block on (or fail because of) the network
        set({ user: null, accessToken: null, refreshToken: null, status: 'idle', error: null })
        broadcastAuth({ type: 'logout' })
        if (token) {
          void authApi.logout(token).catch(() => {
            /* best-effort server-side revoke */
          })
        }
        return Promise.resolve()
      },

      refresh: async () => {
        if (refreshInFlight) return refreshInFlight

        const rt = get().refreshToken
        if (!rt) return

        const run = async (): Promise<void> => {
          const epoch = sessionEpoch
          const res = await withRefreshLock(async () => {
            // another tab may have rotated while we waited for the lock — adopt its pair
            const persisted = readPersistedAuth()
            if (persisted && persisted.refreshToken !== get().refreshToken) {
              if (epoch === sessionEpoch) {
                set({
                  user: persisted.user,
                  accessToken: persisted.accessToken,
                  refreshToken: persisted.refreshToken,
                  status: 'authenticated',
                })
              }
              return null
            }
            return refreshWithRetry(rt)
          })

          if (!res) return
          if (epoch !== sessionEpoch) return // logged out mid-flight — drop the result
          set({
            user: res.user,
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            status: 'authenticated',
          })
          broadcastAuth({ type: 'tokens' })
        }

        refreshInFlight = run()
          .catch(async (err: unknown) => {
            if (isDefinitiveAuthFailure(err)) {
              await get().logout()
              authFailureListeners.forEach((cb) => cb())
            }
            throw err
          })
          .finally(() => {
            refreshInFlight = null
          })

        return refreshInFlight
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: AUTH_STORAGE_KEY,
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

// another tab logged out — mirror locally, no API call and no rebroadcast (avoids loops)
function clearLocalSession() {
  sessionEpoch++
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    status: 'idle',
    error: null,
  })
}

authChannel?.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data as { type?: string } | null
  if (message?.type === 'logout') {
    clearLocalSession()
    return
  }
  if (message?.type === 'tokens' && !refreshInFlight) {
    const persisted = readPersistedAuth()
    if (persisted && persisted.refreshToken !== useAuthStore.getState().refreshToken) {
      useAuthStore.setState({
        user: persisted.user,
        accessToken: persisted.accessToken,
        refreshToken: persisted.refreshToken,
        status: 'authenticated',
      })
    }
  }
})

function scheduleRefresh(accessToken: string | null) {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  if (!accessToken) return

  let exp: number | null = null
  try {
    const payload = decodeJwtPayload(accessToken)
    if (typeof payload.exp === 'number') exp = payload.exp
  } catch {
    /* invalid token */
  }
  if (exp === null) return

  const delay = exp * 1000 - Date.now() - REFRESH_LEAD_MS
  if (delay <= 0) {
    void useAuthStore
      .getState()
      .refresh()
      .catch(() => {
        /* transient — a later trigger retries */
      })
    return
  }

  refreshTimer = setTimeout(() => {
    void useAuthStore
      .getState()
      .refresh()
      .catch(() => {
        /* transient — a later trigger retries */
      })
  }, delay)
}

useAuthStore.subscribe((state) => {
  scheduleRefresh(state.accessToken)
})

// hydration is synchronous during create(), i.e. before the subscribe above exists — re-arm
// from current state so a reload with an expired access token recovers immediately
scheduleRefresh(useAuthStore.getState().accessToken)

// Timers are throttled/suspended in background tabs, so re-check on wake signals.
function maybeRefreshNow() {
  const { accessToken, refreshToken } = useAuthStore.getState()
  if (!accessToken || !refreshToken) return
  if (isExpiringSoon(accessToken)) {
    void useAuthStore
      .getState()
      .refresh()
      .catch(() => {
        /* transient — a later trigger retries */
      })
  }
}

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeRefreshNow()
})
window.addEventListener('online', maybeRefreshNow)
window.addEventListener('focus', maybeRefreshNow)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) maybeRefreshNow()
})

export function subscribeAuthFailure(cb: () => void): () => void {
  authFailureListeners.add(cb)
  return () => {
    authFailureListeners.delete(cb)
  }
}
