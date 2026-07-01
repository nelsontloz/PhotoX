import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { FaMapLocationDot, FaSpinner } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { listAssets } from '../../api/assets'
import { RequireAuth } from '../../components/RequireAuth'
import { AppHeader } from '../../components/AppHeader'
import { Sidebar } from '../../components/Sidebar'
import { UploadNotification } from '../../components/UploadNotification'
import { formatShortDate } from '../../lib/dateFormat'

const markerIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

function PlacesContent() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const PAGE = 100
    const all: Asset[] = []
    let offset = 0
    let total = 0

    listAssets({ hasLocations: true, limit: PAGE, offset: 0 })
      .then(async (first) => {
        if (cancelled) return
        all.push(...first.items)
        total = first.total
        offset = PAGE

        while (offset < total && !cancelled) {
          const page = await listAssets({ hasLocations: true, limit: PAGE, offset })
          if (cancelled) return
          all.push(...page.items)
          offset += PAGE
        }

        if (cancelled) return
        setAssets([...all])
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load photos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading || error || assets.length === 0 || !containerRef.current) return

    const map = L.map(containerRef.current, { zoomControl: false }).setView([0, 0], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(map)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    const bounds = L.latLngBounds(
      assets.map((a) => [a.latitude!, a.longitude!] as [number, number]),
    )

    for (const asset of assets) {
      L.marker([asset.latitude!, asset.longitude!], { icon: markerIcon })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:system-ui,sans-serif;min-width:140px">
            <div style="font-size:13px;color:#334155">${formatShortDate(new Date(asset.takenAt ?? asset.uploadedAt))}</div>
            ${asset.kind === 'video' ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">Video</div>' : ''}
          </div>`,
        )
    }

    map.fitBounds(bounds, { padding: [40, 40] })
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [assets, loading, error])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <FaSpinner className="text-2xl text-blue-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-red-500 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-blue-500 text-sm font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <div className="mb-8 w-20 h-20 rounded-full bg-blue-500/10 dark:bg-blue-500/15 ring-1 ring-blue-500/25 flex items-center justify-center">
          <FaMapLocationDot className="text-4xl text-blue-500 dark:text-blue-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          No photos with location data found
        </h1>
        <p className="mt-4 text-slate-500 dark:text-slate-400 text-base sm:text-lg leading-relaxed max-w-md">
          Photos with GPS coordinates will appear on the map.
        </p>
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full" />
}

export default function PlacesPage() {
  return (
    <RequireAuth>
      <div className="flex flex-col h-screen overflow-hidden">
        <AppHeader />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-hidden relative">
            <PlacesContent />
          </main>
        </div>
        <UploadNotification />
      </div>
    </RequireAuth>
  )
}
