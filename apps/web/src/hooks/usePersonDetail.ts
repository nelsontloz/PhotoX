import { useCallback, useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import type { PersonDto } from '@photox/shared-types'
import { getPerson } from '../api/persons'

export function usePersonDetail(id: string | undefined) {
  const [person, setPerson] = useState<PersonDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  const retry = useCallback(() => {
    setRetryKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const p = await getPerson(id)
        if (cancelled) return
        setPerson(p)
      } catch (err: unknown) {
        if (cancelled) return
        setPerson(null)
        if (isAxiosError(err) && err.response?.status === 404) {
          setNotFound(true)
        } else {
          // 500s, network drops and 403s are outages, not deletions — never
          // leak axios verbatim and never report them as "not found".
          setError('Failed to load person')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, retryKey])

  return { person, setPerson, loading, error, notFound, retry }
}
