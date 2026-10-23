import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { FaMapLocationDot } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { getFileStreamUrl, listAllAssets } from '../../api/assets'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { ViewerHost } from '../../components/ViewerHost'
import { locationMarkerIcon } from '../../components/AssetViewer/sections/LocationSection'
import { effectiveAssetDate } from '../../lib/dateFormat'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { useAsyncFetch } from '../../hooks/useAsyncFetch'
import { MapSidePanel } from './MapSidePanel'

const EMPTY: Asset[] = []

// Individual (unclustered) markers: a 40px bubble matching the cluster bubbles. A ready
// thumbnail fills it; while the thumbnail job hasn't registered one yet (thumbnailStatus
// 'pending' — videos sit in that state far longer than photos: the thumbnail worker waits for
// metadata, then ffmpeg-extracts a frame per size) the identical bubble shows a spinner, since
// the asset list is fetched once per visit and never re-renders. Only a genuinely thumb-less
// asset (never succeeded) keeps the viewer's 12px dot. A clicked marker swaps to the selected
// variant (same icon + accent ring), matching the cluster bubbles' `.is-selected` language.
// Assets sharing byte-identical coordinates (same-spot phone videos) would otherwise stack
// pixel-exactly — only the topmost bubble reachable — so they collapse into ONE group marker
// keyed `${lat},${lng}`: the newest asset's icon + a corner count chip, clicked like a cluster.
const THUMB_BUBBLE_PX = 40

const PLAY_BADGE =
  '<span class="photox-thumb-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>'

// Selected variant of the 12px dot: the shared `locationMarkerIcon` is also used by the viewer's
// mini map, so the accent ring lives on a copy here instead of on that icon.
const selectedDotIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 0 3px var(--color-tertiary)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

function markerIconFor(asset: Asset, selected = false, groupSize = 1): L.DivIcon {
  const thumb = asset.thumbnails?.find((t) => t.size === 'md') ?? asset.thumbnails?.[0]
  const pending = thumb === undefined && asset.thumbnailStatus === 'pending'
  if (thumb === undefined && !pending) return selected ? selectedDotIcon : locationMarkerIcon
  // Eager, not lazy: icons are built while the map still sits at the dummy [0, 0] view and only
  // then move by CSS transform, so the browser's lazy-image viewport check may never run again and
  // the bubble stays an empty blue circle until a zoom/pan rebuilds the marker.
  // shortcut: at zoom >= 16 (clustering off) every placed asset's thumbnail loads; gate on a
  // viewport check if a placed library ever grows past a few thousand photos.
  const inner = thumb
    ? `<img src="${getFileStreamUrl(thumb.fileId)}" alt="" decoding="async" draggable="false">${asset.kind === 'video' ? PLAY_BADGE : ''}`
    : '<span class="photox-thumb-spinner"></span>'
  // The count chip is a sibling of the circle: the circle's overflow: hidden would clip a corner
  // chip, while the leaflet icon element (position: absolute, 40x40) is already a positioning box.
  const count = groupSize > 1 ? `<span class="photox-thumb-count">${groupSize}</span>` : ''
  return L.divIcon({
    className: '',
    html: `<div class="photox-thumb-marker${pending ? ' is-pending' : ''}${selected ? ' is-selected' : ''}">${inner}</div>${count}`,
    iconSize: [THUMB_BUBBLE_PX, THUMB_BUBBLE_PX],
    iconAnchor: [THUMB_BUBBLE_PX / 2, THUMB_BUBBLE_PX / 2],
  })
}

// A bubble can hold thousands of leaves; the panel grid (and the viewer's prev/next walk, which
// follows the panel list) only ever sees the first slice.
const PANEL_MAX = 200

interface PlacesView {
  lat: number
  lng: number
  zoom: number
}

// One bad or missing piece (?lat=&lng=&z=) discards the whole URL source and falls through to the
// next one, instead of restoring a half-valid view. Zoom range matches the max-zoom-19 tile layer.
function numberParam(
  params: URLSearchParams,
  key: string,
  min: number,
  max: number,
): number | null {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

function readViewParams(params: URLSearchParams): PlacesView | null {
  const lat = numberParam(params, 'lat', -90, 90)
  const lng = numberParam(params, 'lng', -180, 180)
  const zoom = numberParam(params, 'z', 0, 19)
  return lat !== null && lng !== null && zoom !== null ? { lat, lng, zoom } : null
}

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
  // Individual markers are static divIcons, so the highlight swaps them via setIcon; `selected`
  // diffs against the last applied state so only markers that changed pay a setIcon. Markers the
  // plugin has taken into a cluster are off the map, where setIcon is just an options swap. One
  // entry per co-located group (a lone asset is a group of one), keyed `${lat},${lng}`.
  const markersRef = useRef<Map<string, { marker: L.Marker; assets: Asset[]; selected: boolean }>>(
    new Map(),
  )
  const [searchParams, setSearchParams] = useSearchParams()
  // The map effect's moveend handler outlives the render it was created in, and react-router
  // rebuilds setSearchParams around the location it captured — re-point both each render so a pan
  // never rewrites the URL from a stale snapshot (e.g. resurrecting the viewer's closed ?asset=).
  const urlRef = useRef({ searchParams, setSearchParams })
  urlRef.current = { searchParams, setSearchParams }
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
  // selection over several bubbles) and refreshClusters repaints on the spot. Individual markers
  // are repainted here instead — same ids, same selected ring as a clicked cluster bubble. A
  // group marker is selected when any asset it stands for is.
  const applyMarkerHighlight = () => {
    const selectedIds = selectedAssetIdsRef.current
    for (const binding of markersRef.current.values()) {
      const selected =
        selectedIds !== null && binding.assets.some((asset) => selectedIds.has(asset.id))
      if (binding.selected !== selected) {
        binding.selected = selected
        binding.marker.setIcon(markerIconFor(binding.assets[0]!, selected, binding.assets.length))
      }
    }
  }

  const selectAssets = (next: Asset[] | null) => {
    if (next === null && selectedAssetIdsRef.current === null) return
    selectedAssetIdsRef.current = next ? new Set(next.map((asset) => asset.id)) : null
    clustersRef.current?.refreshClusters()
    applyMarkerHighlight()
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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

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
        // Markers stand for however many assets share their coordinates, so the bubble's count
        // and its selected check read the groups, not the marker count.
        const groupAssets = cluster
          .getAllChildMarkers()
          .flatMap((marker) => assetByMarker.get(marker) ?? [])
        const selected =
          selectedIds !== null && groupAssets.some((asset) => selectedIds.has(asset.id))
        return L.divIcon({
          className: '',
          html: `<div class="photox-cluster-bubble${selected ? ' is-selected' : ''}">${groupAssets.length.toLocaleString()}</div>`,
          iconSize: [40, 40],
        })
      },
    })
    clustersRef.current = clusters

    const assetByMarker = new WeakMap<L.Marker, Asset[]>()

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

    // Assets at byte-identical coordinates collapse into one marker per exact pair, newest-first
    // (newest like the cluster panel drives both the icon and the click selection).
    const groups = new Map<string, Asset[]>()
    for (const asset of assets) {
      const key = `${asset.latitude},${asset.longitude}`
      const group = groups.get(key)
      if (group) group.push(asset)
      else groups.set(key, [asset])
    }
    for (const group of groups.values()) {
      group.sort((a, b) => Date.parse(effectiveAssetDate(b)) - Date.parse(effectiveAssetDate(a)))
    }

    for (const [key, group] of groups) {
      // A click selects the whole group — highlight in place + panel open, like a cluster click.
      // No Leaflet popup: the date lives in the side panel and the viewer.
      const newest = group[0]!
      const marker = L.marker([newest.latitude!, newest.longitude!], {
        icon: markerIconFor(newest, false, group.length),
      }).on('click', () => {
        selectAssets(group)
        setSelection(group)
      })
      assetByMarker.set(marker, group)
      markersRef.current.set(key, { marker, assets: group, selected: false })
      clusters.addLayer(marker)
    }

    map.addLayer(clusters)
    // Re-syncs markers with an already-applied selection when the map rebuilds (e.g. refetch).
    applyMarkerHighlight()

    // Registered after the group, so the plugin's own zoom/move handlers have already swapped
    // the cluster layers. It reuses each bubble's cached icon when re-showing it, so the
    // highlight has to be repainted from the current selection before the user sees it.
    map.on('zoomend moveend', () => clusters.refreshClusters())

    // View persistence: on every settle, mirror the view into the URL with a replace — panning
    // must never fill history. Equal params are skipped so the setView below doesn't trigger a
    // redundant replace. In-app navigation lands on a bare `/places` (no params) and resets to
    // the full-library view; only a reload restores.
    const writeView = () => {
      const center = map.getCenter()
      const view: PlacesView = {
        lat: Number(center.lat.toFixed(5)), // ~1 m
        lng: Number(center.lng.toFixed(5)),
        zoom: Number(map.getZoom().toFixed(2)),
      }
      const params = urlRef.current.searchParams
      if (
        params.get('lat') === String(view.lat) &&
        params.get('lng') === String(view.lng) &&
        params.get('z') === String(view.zoom)
      )
        return
      const next = new URLSearchParams(params)
      next.set('lat', String(view.lat))
      next.set('lng', String(view.lng))
      next.set('z', String(view.zoom))
      urlRef.current.setSearchParams(next, { replace: true })
    }
    map.on('moveend', writeView)

    // Initial view: the URL (reload, shared link); anything else fits everything.
    const restored = readViewParams(urlRef.current.searchParams)
    if (restored) {
      map.setView([restored.lat, restored.lng], restored.zoom, { animate: false })
    } else {
      // fitBounds can land between whole levels now that zoomSnap is fractional, which opens the
      // page on scaled-up tiles; round that back down to the whole level the old whole-level snap
      // landed on (rounding up would push the outermost markers out of their padding).
      // animate: false keeps the whole settle synchronous, so the first painted frame already
      // shows the final view instead of flashing the dummy [0, 0]/2 view and gliding to the
      // bounds (replayed by StrictMode's dev double-mount).
      map.once('zoomend', () => map.setZoom(Math.floor(map.getZoom()), { animate: false }))
      map.fitBounds(bounds, { padding: [40, 40], animate: false })
    }

    return () => {
      mapRef.current = null
      clustersRef.current = null
      markersRef.current.clear()
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
