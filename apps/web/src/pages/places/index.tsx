import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { FaMapLocationDot } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { listAllAssets } from '../../api/assets'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { locationMarkerIcon } from '../../components/AssetViewer/sections/LocationSection'
import { formatShortDate } from '../../lib/dateFormat'
import { addOsmTileLayer } from '../../lib/leafletMap'

function PlacesContent() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const all = await listAllAssets({ hasLocations: true })
        if (!cancelled) setAssets(all)
      } catch {
        if (!cancelled) setError('Failed to load photos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading || error || assets.length === 0 || !containerRef.current) return

    const map = L.map(containerRef.current, { zoomControl: false }).setView([0, 0], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(map)

    addOsmTileLayer(map)

    const bounds = L.latLngBounds(
      assets.map((a) => [a.latitude!, a.longitude!] as [number, number]),
    )

    for (const asset of assets) {
      L.marker([asset.latitude!, asset.longitude!], { icon: locationMarkerIcon })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:system-ui,sans-serif;min-width:140px">
            <div style="font-size:13px;color:#334155">${formatShortDate(new Date(asset.takenAt ?? asset.uploadedAt))}</div>
            ${asset.kind === 'video' ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">Video</div>' : ''}
          </div>`,
        )
    }

    map.fitBounds(bounds, { padding: [40, 40] })

    return () => {
      map.remove()
    }
  }, [assets, loading, error])

  if (loading) {
    return <LoadingState className="flex items-center justify-center h-full" />
  }

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => window.location.reload()}
        className="flex flex-col items-center justify-center h-full gap-4"
        messageClassName="text-red-500"
      />
    )
  }

  if (assets.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<FaMapLocationDot className="text-4xl text-blue-500 dark:text-blue-400" />}
          circleClassName="bg-blue-500/10 dark:bg-blue-500/15 ring-1 ring-blue-500/25"
          title="No photos with location data found"
          body="Photos with GPS coordinates will appear on the map."
        />
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full" />
}

export default function PlacesPage() {
  return (
    <RequireAuth>
      <AppShell mainClassName="flex-1 overflow-hidden relative">
        <PlacesContent />
      </AppShell>
    </RequireAuth>
  )
}
