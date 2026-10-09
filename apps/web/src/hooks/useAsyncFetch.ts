import { useCallback, useEffect, useRef, useState } from 'react'

interface UseAsyncFetchOptions {
  /** Changing this key re-runs the fetch. Same-key calls while one is in flight are dropped
   *  (StrictMode dev double-mount, duplicate refresh clicks). */
  refreshKey?: number
  errorMessage: string
  /**
   * 'once' (default) sets `loading` only for the first load so refreshes update in place
   * (e.g. the viewer stays mounted); 'always' shows loading on every fetch.
   */
  loadingMode?: 'once' | 'always'
}

/**
 * Shared fetch state for list hooks: first-load gating, in-place refresh, stale-response guards.
 * `fetcher` may be recreated every render — only `refreshKey`/`errorMessage`/`loadingMode` trigger
 * a refetch (or an explicit `refresh()` call).
 */
export function useAsyncFetch<T>(
  fetcher: () => Promise<T>,
  { refreshKey = 0, errorMessage, loadingMode = 'once' }: UseAsyncFetchOptions,
) {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const fetchIdRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const inFlightKeyRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    if (inFlightKeyRef.current === refreshKey) return
    inFlightKeyRef.current = refreshKey
    const fetchId = ++fetchIdRef.current
    try {
      if (loadingMode === 'always' || !loadedOnceRef.current) setLoading(true)
      setError(null)
      const result = await fetcherRef.current()
      if (fetchId !== fetchIdRef.current) return
      setData(result)
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return
      setError((err as Error).message ?? errorMessage)
    } finally {
      if (fetchId === fetchIdRef.current) {
        loadedOnceRef.current = true
        setLoading(false)
        inFlightKeyRef.current = null
      }
    }
  }, [refreshKey, errorMessage, loadingMode])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
