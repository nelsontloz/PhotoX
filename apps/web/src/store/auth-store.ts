import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User, AuthResponse, JwtPayload } from '@photox/shared-types'
import * as authApi from '../api/auth'
import { sleep } from '../lib/sleep'

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

// cookie session: tokens live in memory only — the persisted profile just restores the UI
// across reloads while the HttpOnly cookies prove the session to the API.
// localStorage is untrusted, so merge() below adopts only the profile, never tokens.

// ponytail: BroadcastChannel-only cross-tab signalling — storage-event fallback only if
// browsers without BroadcastChannel support ever matter.
const authChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('photox.auth') : null

function broadcastAuth(message: { type: 'logout' }) {
  authChannel?.postMessage(message)
}

// Web Locks are cross-tab: serialises rotation so single-use refresh tokens are not raced
// between tabs. ponytail: direct call fallback — jsdom and old browsers lack navigator.locks.
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn()
  const result = (await navigator.locks.request('photox.auth.refresh', () => fn())) as T
  return result
}

async function refreshWithRetry(rt: string | undefined): Promise<AuthResponse> {
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
        // always tell the server: with a memory token it revokes, without one the refresh
        // cookie still revokes — and either way both cookies are cleared
        void authApi.logout(token ?? undefined).catch(() => {
          /* best-effort server-side revoke */
        })
        return Promise.resolve()
      },

      refresh: async () => {
        if (refreshInFlight) return refreshInFlight

        const run = async (): Promise<void> => {
          const epoch = sessionEpoch
          const res = await withRefreshLock(async () => {
            // jar-first: the shared cookie always holds the newest rotation, so a tab that
            // waited on the lock never replays its stale memory token into the reuse-kill;
            // memory is fallback only for a jar the server can't see (400 = no credential)
            const rt = get().refreshToken ?? undefined
            try {
              return await refreshWithRetry(undefined)
            } catch (err) {
              const status = (err as { response?: { status?: number } }).response?.status
              if (rt === undefined || status !== 400) throw err
              return refreshWithRetry(rt)
            }
          })

          if (epoch !== sessionEpoch) return // logged out mid-flight — drop the result
          set({
            user: res.user,
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            status: 'authenticated',
          })
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
      // tokens are memory-only; an old disk payload may still carry them — never spread it
      partialize: (state) => ({ user: state.user }),
      merge: (persisted, current) => {
        const data = persisted as { user?: User | null }
        const user = data.user ?? null
        return { ...current, user, status: user ? 'authenticated' : 'idle' }
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
