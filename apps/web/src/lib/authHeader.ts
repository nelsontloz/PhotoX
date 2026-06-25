import { useAuthStore } from '../store/auth-store'

export function getAuthHeader(): { Authorization: string } | Record<string, never> {
  const token = useAuthStore.getState().accessToken
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export function getAuthHeaderValue(): string | undefined {
  const token = useAuthStore.getState().accessToken
  return token ? `Bearer ${token}` : undefined
}
