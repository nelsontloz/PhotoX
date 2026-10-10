import { useEffect, useState } from 'react'
import type { PersonDto } from '@photox/shared-types'
import { getPerson } from '../api/persons'

export function usePersonDetail(id: string | undefined) {
  const [person, setPerson] = useState<PersonDto | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const p = await getPerson(id)
        if (cancelled) return
        setPerson(p)
      } catch {
        /* ponytail: silent fail */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  return { person, setPerson, loading }
}
