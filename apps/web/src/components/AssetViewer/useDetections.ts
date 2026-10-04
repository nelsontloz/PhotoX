import { useEffect, useState } from 'react'
import type { AssetDetectionDto } from '@photox/shared-types'
import { getAssetDetections } from '../../api/detections'

type DetectionStatus = 'idle' | 'loading' | 'ready'

interface DetectionState {
  assetId: string
  status: DetectionStatus
  detections: AssetDetectionDto[]
}

// Session cache: one entry per asset, filled the first time its overlay is switched on. Failed
// fetches are not cached, so toggling again retries instead of pinning a transient error.
const cache = new Map<string, AssetDetectionDto[]>()
const inflight = new Map<string, Promise<AssetDetectionDto[]>>()

function loadDetections(assetId: string): Promise<AssetDetectionDto[]> {
  const cached = cache.get(assetId)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(assetId)
  if (pending) return pending
  const request = getAssetDetections(assetId)
    .then((res) => {
      cache.set(assetId, res.detections)
      return res.detections
    })
    .finally(() => {
      inflight.delete(assetId)
    })
  inflight.set(assetId, request)
  return request
}

/** Lazy detections for the viewer overlay: nothing is fetched until `enabled` flips true. */
export function useDetections(
  assetId: string,
  enabled: boolean,
): { status: DetectionStatus; detections: AssetDetectionDto[] } {
  const [state, setState] = useState<DetectionState | null>(null)

  useEffect(() => {
    if (!enabled) return
    const cached = cache.get(assetId)
    if (cached) {
      setState({ assetId, status: 'ready', detections: cached })
      return
    }
    let cancelled = false
    setState({ assetId, status: 'loading', detections: [] })
    void loadDetections(assetId)
      .then((detections) => {
        if (!cancelled) setState({ assetId, status: 'ready', detections })
      })
      .catch(() => {
        // 404 / network: same silent empty state as "no objects detected"
        if (!cancelled) setState({ assetId, status: 'ready', detections: [] })
      })
    return () => {
      cancelled = true
    }
  }, [assetId, enabled])

  // state from a previous asset must never paint boxes on the current one
  if (state?.assetId !== assetId) {
    return { status: enabled ? 'loading' : 'idle', detections: [] }
  }
  return { status: state.status, detections: state.detections }
}
