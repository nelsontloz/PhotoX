import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth-store'

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)

  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
