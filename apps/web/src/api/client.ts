import axios, { type AxiosError } from 'axios'
import { useAuthStore, isExpiringSoon } from '../store/auth-store'

export const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  // cookie session: the HttpOnly access/refresh cookies ride every same-origin request
  withCredentials: true,
})

api.interceptors.request.use(async (config) => {
  // auth endpoints manage their own tokens; refreshing from here would recurse
  if (config.url?.includes('/v1/auth/')) return config

  const { accessToken, refreshToken } = useAuthStore.getState()
  if (accessToken && refreshToken && isExpiringSoon(accessToken)) {
    await useAuthStore
      .getState()
      .refresh()
      .catch(() => {
        /* transient failure — the cookies still authenticate this request */
      })
  }

  // no Bearer header: the access cookie authenticates same-origin calls (media tags too)
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosError['config'] & {
      headers: Record<string, string>
    }

    if (
      error.response?.status !== 401 ||
      originalRequest.headers['X-Auth-Retry'] ||
      originalRequest.url?.includes('/v1/auth/')
    ) {
      return Promise.reject(error)
    }

    const beforeToken = useAuthStore.getState().accessToken
    try {
      await useAuthStore.getState().refresh()
    } catch {
      // transient refresh failure: keep the session, surface the original 401
      return Promise.reject(error)
    }

    const newToken = useAuthStore.getState().accessToken
    if (!newToken || newToken === beforeToken) {
      return Promise.reject(error)
    }

    // cookies (refreshed above) authenticate the retry — no Bearer header
    originalRequest.headers['X-Auth-Retry'] = '1'
    return api(originalRequest)
  },
)

/** Shared page-through params for list endpoints (albums, persons). */
export interface PageParams {
  limit?: number
  offset?: number
}
