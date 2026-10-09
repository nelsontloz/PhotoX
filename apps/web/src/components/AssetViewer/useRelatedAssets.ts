import { useEffect, useState } from 'react'
import type { Asset, RelatedAssetsResponse } from '@photox/shared-types'
import { getAssetDuplicates, getSimilarAssets } from '../../api/related'

export type RelatedStatus = 'idle' | 'loading' | 'ready'

export interface RelatedAssets {
  status: RelatedStatus
  items: Asset[]
  total: number
}

interface RelatedState extends RelatedAssets {
  assetId: string
}

// Session cache per asset + kind, same shape as useDetections: one entry per viewed asset,
// filled the first time its viewer opens. Failed fetches are not cached, so a later open retries.
function makeLoader(fetcher: (assetId: string) => Promise<RelatedAssetsResponse>) {
  const cache = new Map<string, RelatedAssetsResponse>()
  const inflight = new Map<string, Promise<RelatedAssetsResponse>>()
  return (assetId: string): Promise<RelatedAssetsResponse> => {
    const cached = cache.get(assetId)
    if (cached) return Promise.resolve(cached)
    const pending = inflight.get(assetId)
    if (pending) return pending
    const request = fetcher(assetId)
      .then((res) => {
        cache.set(assetId, res)
        return res
      })
      .finally(() => {
        inflight.delete(assetId)
      })
    inflight.set(assetId, request)
    return request
  }
}

const loadSimilar = makeLoader(getSimilarAssets)
const loadDuplicates = makeLoader(getAssetDuplicates)

function useRelatedAssets(
  assetId: string,
  enabled: boolean,
  load: (assetId: string) => Promise<RelatedAssetsResponse>,
): RelatedAssets {
  const [state, setState] = useState<RelatedState | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void load(assetId)
      .then((res) => {
        if (!cancelled) setState({ assetId, status: 'ready', items: res.items, total: res.total })
      })
      .catch(() => {
        // 404 / network: silent empty, same as "nothing related"
        if (!cancelled) setState({ assetId, status: 'ready', items: [], total: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [assetId, enabled, load])

  // Stale-while-revalidate: serve the previous asset's results while the next fetch is in
  // flight. Blanking on assetId change unmounted the whole related tray and reflowed the
  // media stage — a visible flash on every next/prev click, worst on mobile. Status stays
  // 'loading' so callers can tell the items are not this asset's yet.
  if (state?.assetId !== assetId) {
    if (state && enabled) return { status: 'loading', items: state.items, total: state.total }
    return { status: enabled ? 'loading' : 'idle', items: [], total: 0 }
  }
  return { status: state.status, items: state.items, total: state.total }
}

/** "More like this" — one fetch when the viewer opens, session-cached per asset. */
export function useSimilarAssets(assetId: string, enabled = true): RelatedAssets {
  return useRelatedAssets(assetId, enabled, loadSimilar)
}

/** "Possible duplicates" — one fetch when the viewer opens, session-cached per asset. */
export function useAssetDuplicates(assetId: string, enabled = true): RelatedAssets {
  return useRelatedAssets(assetId, enabled, loadDuplicates)
}
