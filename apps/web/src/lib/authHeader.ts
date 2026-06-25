import { useAuthStore } from '../store/auth-store'

export function getAuthHeaderValue(): string | undefined {
  const token = useAuthStore.getState().accessToken
  return token ? `Bearer ${token}` : undefined
}
