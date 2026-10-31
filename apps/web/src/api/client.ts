import axios, { type AxiosError } from 'axios'
import { useAuthStore } from '../store/auth-store'

export const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  // cookie session: the HttpOnly access/refresh cookies ride every same-origin request
  withCredentials: true,
})

// No request interceptor: the access cookie authenticates every call (media tags too), and the
// auth store already refreshes ahead of expiry + on wake signals. The 401 retry below is the
// last-resort trigger.

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
