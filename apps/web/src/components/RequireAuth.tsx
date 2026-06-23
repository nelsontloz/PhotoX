import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/auth-store'
import { useAuthFailureRedirect } from '../hooks/useAuthFailureRedirect'

interface RequireAuthProps {
  children: React.ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  useAuthFailureRedirect()
  const status = useAuthStore((s) => s.status)
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background-dark text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-400">Loading...</span>
        </div>
      </div>
    )
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
