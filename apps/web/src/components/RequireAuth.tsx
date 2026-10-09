import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore, subscribeAuthFailure } from '../store/auth-store'
import { LoadingState } from './StateViews'

interface RequireAuthProps {
  children: React.ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  const navigate = useNavigate()
  useEffect(() => {
    return subscribeAuthFailure(() => {
      void navigate('/login', { replace: true })
    })
  }, [navigate])
  const status = useAuthStore((s) => s.status)
  const location = useLocation()

  if (status === 'loading') {
    return <LoadingState className="min-h-screen bg-background-dark" />
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
