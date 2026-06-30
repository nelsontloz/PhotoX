import axios, { type AxiosError } from 'axios'
import { useAuthStore } from '../store/auth-store'

export const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

api.interceptors.request.use((config) => {
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

    await useAuthStore.getState().refresh()

    const newToken = useAuthStore.getState().accessToken
    if (!newToken) {
      return Promise.reject(error)
    }

    originalRequest.headers['X-Auth-Retry'] = '1'
    originalRequest.headers.Authorization = `Bearer ${newToken}`
    return api(originalRequest)
  },
)

export const healthApi = axios.create({
  timeout: 5000,
})
