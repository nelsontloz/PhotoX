import axios from 'axios'
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

export const healthApi = axios.create({
  timeout: 5000,
})
