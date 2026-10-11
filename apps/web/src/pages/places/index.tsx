import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { FaMapLocationDot } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { listAllAssets } from '../../api/assets'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { ViewerHost } from '../../components/ViewerHost'
import { locationMarkerIcon } from '../../components/AssetViewer/sections/LocationSection'
import { formatShortDate, effectiveAssetDate } from '../../lib/dateFormat'
import { addOsmTileLayer } from '../../lib/leafletMap'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { useAsyncFetch } from '../../hooks/useAsyncFetch'
import { MapSidePanel } from './MapSidePanel'

const EMPTY: Asset[] = []

// A bubble can hold thousands of leaves; the panel grid (and the viewer's prev/next walk, which
// follows the panel list) only ever sees the first slice.
const PANEL_MAX = 200

function PlacesContent() {
  const { data, loading, error, refresh } = useAsyncFetch(
    () => listAllAssets({ hasLocations: true }),
    { errorMessage: 'Failed to load photos', loadingMode: 'always' },
  )
  const assets = data ?? EMPTY
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [selection, setSelection] = useState<Asset[]>([])
  const panelAssets = useMemo(
    () => (selection.length > PANEL_MAX ? selection.slice(0, PANEL_MAX) : selection),
    [selection],
  )
  // Viewer prev/next walks the clicked bubble (the panel's list), not the whole library.
  const nav = useAssetNavigation({ assets: panelAssets })
  const panelOpen = selection.length > 0

  useEffect(() => {
    if (loading || error || assets.length === 0 || !containerRef.current) return

    const map = L.map(containerRef.current, { zoomControl: false }).setView([0, 0], 2)
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)

    addOsmTileLayer(map)

    const bounds = L.latLngBounds(
      assets.map((a) => [a.latitude!, a.longitude!] as [number, number]),
    )

    const clusters = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      disableClusteringAtZoom: 16,
      iconCreateFunction: (cluster) =>
        L.divIcon({
          className: '',
          html: `<div class="photox-cluster-bubble">${cluster.getChildCount().toLocaleString()}</div>`,
          iconSize: [40, 40],
        }),
    })

    const assetByMarker = new WeakMap<L.Marker, Asset>()

    // Cluster clicks (and Enter on a focused cluster) open the panel; the plugin's own
    // zoomToBoundsOnClick default still flies the map to the cluster's bounds.
    const openCluster = (event: L.LeafletEvent) => {
      // Leaflet's event type declares `layer` as any (`any & T` would collapse a cast); the
      // plugin puts the clicked cluster marker there.
      const cluster = event.layer as L.MarkerCluster
      const picked = cluster
        .getAllChildMarkers()
        .flatMap((marker) => assetByMarker.get(marker) ?? [])
      // Cluster-walk order is internal; the panel reads newest-first like the timeline.
      picked.sort((a, b) => Date.parse(effectiveAssetDate(b)) - Date.parse(effectiveAssetDate(a)))
      setSelection(picked)
    }
    clusters.on('clusterclick', openCluster)
    clusters.on('clusterkeypress', openCluster)

    for (const asset of assets) {
      const marker = L.marker([asset.latitude!, asset.longitude!], { icon: locationMarkerIcon })
        .bindPopup(
          `<div style="font-family:system-ui,sans-serif;min-width:140px">
            <div style="font-size:13px;color:#334155">${formatShortDate(new Date(asset.takenAt ?? asset.uploadedAt))}</div>
            ${asset.kind === 'video' ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">Video</div>' : ''}
          </div>`,
        )
        .on('click', () => setSelection([asset]))
      assetByMarker.set(marker, asset)
      clusters.addLayer(marker)
    }

    map.addLayer(clusters)

    map.fitBounds(bounds, { padding: [40, 40] })

    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [assets, loading, error])

  // The panel takes width away from the map container; leaflet must re-measure or the center
  // and tile grid drift (it only listens to window resizes).
  useEffect(() => {
    mapRef.current?.invalidateSize()
  }, [panelOpen])

  if (loading) {
    return <LoadingState className="flex items-center justify-center h-full" />
  }

  if (error) {
    return (
      <ErrorState
        message="Failed to load photos"
        onRetry={() => void refresh()}
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

  return (
    <>
      <div className="flex h-full w-full">
        <div ref={containerRef} className="flex-1 min-w-0 h-full" />
        {panelOpen && (
          <MapSidePanel
            assets={panelAssets}
            totalCount={selection.length}
            onClose={() => setSelection([])}
            onSelect={nav.open}
          />
        )}
      </div>
      <ViewerHost
        asset={nav.selected}
        onClose={nav.close}
        onPrev={nav.goPrev}
        onNext={nav.goNext}
        hasPrev={nav.hasPrev}
        hasNext={nav.hasNext}
        siblingAssets={panelAssets}
        onSelectSibling={nav.open}
      />
    </>
  )
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
