import axios, { type AxiosError } from 'axios'
import { useAuthStore, isExpiringSoon } from '../store/auth-store'

export const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

api.interceptors.request.use(async (config) => {
  // auth endpoints manage their own tokens; refreshing from here would recurse
  if (config.url?.includes('/v1/auth/')) return config

  const { accessToken, refreshToken } = useAuthStore.getState()
  if (accessToken && refreshToken && isExpiringSoon(accessToken, 5 * 60 * 1000)) {
    await useAuthStore
      .getState()
      .refresh()
      .catch(() => {
        /* transient failure — the response still attaches the current token */
      })
  }

  // re-read: a proactive refresh above may have swapped the token
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
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

    originalRequest.headers['X-Auth-Retry'] = '1'
    originalRequest.headers.Authorization = `Bearer ${newToken}`
    return api(originalRequest)
  },
)
