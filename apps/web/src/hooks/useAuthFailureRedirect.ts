import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeAuthFailure } from '../store/auth-store'

export function useAuthFailureRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    return subscribeAuthFailure(() => {
      void navigate('/login', { replace: true })
    })
  }, [navigate])
}
