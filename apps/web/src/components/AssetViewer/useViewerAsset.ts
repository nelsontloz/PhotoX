import { useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { getAsset } from '../../api/assets'

export function useViewerAsset(currentId: string, context: Asset[]) {
  const [fetched, setFetched] = useState<Asset | null>(null)
  const inContext = context.find((a) => a.id === currentId)
  const asset = inContext ?? fetched

  useEffect(() => {
    if (inContext) {
      setFetched(null)
      return
    }
    let cancelled = false
    getAsset(currentId)
      .then((a) => {
        if (!cancelled) setFetched(a)
      })
      .catch(() => {
        /* ignored */
      })
    return () => {
      cancelled = true
    }
  }, [currentId, inContext])

  const idx = context.findIndex((a) => a.id === currentId)
  const prev = idx > 0 ? context[idx - 1] : undefined
  const next = idx >= 0 && idx < context.length - 1 ? context[idx + 1] : undefined

  return { asset, prev, next, hasContext: context.length > 0 }
}
