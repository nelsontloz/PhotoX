import { useEffect, useState } from 'react'
import type { Asset, SearchResponse } from '@photox/shared-types'
import { getAssetDuplicates, getSimilarAssets } from '../../api/related'
import { makeLoader } from './makeLoader'

type RelatedStatus = 'idle' | 'loading' | 'ready'

export interface RelatedAssets {
  status: RelatedStatus
  items: Asset[]
  total: number
}

interface RelatedState extends RelatedAssets {
  assetId: string
}

// Session loader shared with useDetections (see ./makeLoader): one entry per viewed
// asset, filled on first open; failed fetches are not cached, so a later open retries.
const loadSimilar = makeLoader(getSimilarAssets)
const loadDuplicates = makeLoader(getAssetDuplicates)

function useRelatedAssets(
  assetId: string,
  enabled: boolean,
  load: (assetId: string) => Promise<SearchResponse>,
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
