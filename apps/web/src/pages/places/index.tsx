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
  const clustersRef = useRef<L.MarkerClusterGroup | null>(null)
  const selectedAssetIdsRef = useRef<ReadonlySet<string> | null>(null)
  const [selection, setSelection] = useState<Asset[]>([])
  const panelAssets = useMemo(
    () => (selection.length > PANEL_MAX ? selection.slice(0, PANEL_MAX) : selection),
    [selection],
  )
  // Viewer prev/next walks the clicked bubble (the panel's list), not the whole library.
  const nav = useAssetNavigation({ assets: panelAssets })
  const panelOpen = selection.length > 0

  // The highlight is held as photo ids, not as a cluster object: the plugin drops and rebuilds
  // its cluster layers on every zoom change, so the bubble(s) holding those leaves change too.
  // iconCreateFunction marks whichever bubble contains them (a deeper zoom can split the
  // selection over several bubbles) and refreshClusters repaints on the spot.
  const selectAssets = (next: Asset[] | null) => {
    if (next === null && selectedAssetIdsRef.current === null) return
    selectedAssetIdsRef.current = next ? new Set(next.map((asset) => asset.id)) : null
    clustersRef.current?.refreshClusters()
  }

  const closePanel = () => {
    setSelection([])
    selectAssets(null)
  }

  useEffect(() => {
    if (loading || error || assets.length === 0 || !containerRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: false,
      // Zoom feel: fractions of a level instead of Leaflet's whole-level snap. zoomSnap is the
      // step grid (a quarter), zoomDelta the button/keyboard/double-click step, and 60px per
      // level gives the wheel half a level per notch. The snap stays at a quarter rather than 0
      // because the wheel delta is platform-scaled (Leaflet divides by up to 40x on Linux
      // Chrome, where the snap floor is what keeps a notch meaningful at all).
      zoomSnap: 0.25,
      zoomDelta: 0.25,
      wheelPxPerZoomLevel: 60,
    }).setView([0, 0], 2)
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
      // A bubble click opens the side panel and highlights the bubble in place — it must not
      // zoom the map into the cluster's bounds. (spiderfyOnMaxZoom stays on: max-zoom bubbles
      // still fan out.)
      zoomToBoundsOnClick: false,
      iconCreateFunction: (cluster) => {
        const selectedIds = selectedAssetIdsRef.current
        const selected =
          selectedIds !== null &&
          cluster.getAllChildMarkers().some((marker) => {
            const asset = assetByMarker.get(marker)
            return asset !== undefined && selectedIds.has(asset.id)
          })
        return L.divIcon({
          className: '',
          html: `<div class="photox-cluster-bubble${selected ? ' is-selected' : ''}">${cluster.getChildCount().toLocaleString()}</div>`,
          iconSize: [40, 40],
        })
      },
    })
    clustersRef.current = clusters

    const assetByMarker = new WeakMap<L.Marker, Asset>()

    // Cluster clicks (and Enter on a focused cluster) open the panel and highlight the bubble.
    const openCluster = (event: L.LeafletEvent) => {
      // Leaflet's event type declares `layer` as any (`any & T` would collapse a cast); the
      // plugin puts the clicked cluster marker there.
      const cluster = event.layer as L.MarkerCluster
      const picked = cluster
        .getAllChildMarkers()
        .flatMap((marker) => assetByMarker.get(marker) ?? [])
      // Cluster-walk order is internal; the panel reads newest-first like the timeline.
      picked.sort((a, b) => Date.parse(effectiveAssetDate(b)) - Date.parse(effectiveAssetDate(a)))
      selectAssets(picked)
      setSelection(picked)
    }
    clusters.on('clusterclick', openCluster)
    clusters.on('clusterkeypress', openCluster)

    // Marker clicks bubble up to the map too, so an empty-map click is one whose target isn't
    // a marker icon; it only drops the highlight (the panel stays until it is closed).
    map.on('click', (event) => {
      const target = event.originalEvent.target as HTMLElement | null
      if (!target?.closest('.leaflet-marker-icon')) selectAssets(null)
    })

    for (const asset of assets) {
      const marker = L.marker([asset.latitude!, asset.longitude!], { icon: locationMarkerIcon })
        .bindPopup(
          `<div style="font-family:system-ui,sans-serif;min-width:140px">
            <div style="font-size:13px;color:#334155">${formatShortDate(new Date(asset.takenAt ?? asset.uploadedAt))}</div>
            ${asset.kind === 'video' ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">Video</div>' : ''}
          </div>`,
        )
        .on('click', () => {
          selectAssets(null)
          setSelection([asset])
        })
      assetByMarker.set(marker, asset)
      clusters.addLayer(marker)
    }

    map.addLayer(clusters)

    // Registered after the group, so the plugin's own zoom/move handlers have already swapped
    // the cluster layers. It reuses each bubble's cached icon when re-showing it, so the
    // highlight has to be repainted from the current selection before the user sees it.
    map.on('zoomend moveend', () => clusters.refreshClusters())

    // fitBounds can land between whole levels now that zoomSnap is fractional, which opens the
    // page on scaled-up tiles; round that back down to the whole level the old whole-level snap
    // landed on (rounding up would push the outermost markers out of their padding).
    map.once('zoomend', () => map.setZoom(Math.floor(map.getZoom()), { animate: false }))
    map.fitBounds(bounds, { padding: [40, 40] })

    return () => {
      mapRef.current = null
      clustersRef.current = null
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
        <div ref={containerRef} className="places-map flex-1 min-w-0 h-full" />
        {panelOpen && (
          <MapSidePanel
            assets={panelAssets}
            totalCount={selection.length}
            onClose={closePanel}
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
