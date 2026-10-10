import { useEffect, useState } from 'react'
import type { AssetDetectionDto } from '@photox/shared-types'
import { getAssetDetections } from '../../api/detections'
import { makeLoader } from './makeLoader'

type DetectionStatus = 'idle' | 'loading' | 'ready'

interface DetectionState {
  assetId: string
  status: DetectionStatus
  detections: AssetDetectionDto[]
}

const loadDetections = makeLoader(getAssetDetections)

/** Lazy detections for the viewer overlay: nothing is fetched until `enabled` flips true. */
export function useDetections(
  assetId: string,
  enabled: boolean,
): { status: DetectionStatus; detections: AssetDetectionDto[] } {
  const [state, setState] = useState<DetectionState | null>(null)

  useEffect(() => {
    if (!enabled) return
    const cached = loadDetections.peek(assetId)
    if (cached) {
      setState({ assetId, status: 'ready', detections: cached.detections })
      return
    }
    let cancelled = false
    setState({ assetId, status: 'loading', detections: [] })
    void loadDetections(assetId)
      .then((res) => {
        if (!cancelled) setState({ assetId, status: 'ready', detections: res.detections })
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
