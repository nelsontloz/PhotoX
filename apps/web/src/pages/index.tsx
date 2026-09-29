import { useCallback, useMemo, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import {
  FaFolderPlus,
  FaImage,
  FaMountain,
  FaSpinner,
  FaTrash,
  FaWandMagicSparkles,
} from 'react-icons/fa6'
import { RequireAuth } from '../components/RequireAuth'
import { AppShell } from '../components/AppShell'
import { AssetViewer } from '../components/AssetViewer/AssetViewer'
import { useTimelineMonths } from '../hooks/useTimelineMonths'
import { useAssetNavigation } from '../hooks/useAssetNavigation'
import { useTimelineLayout } from '../hooks/useTimelineLayout'
import { TimelineGrid } from '../components/Timeline/TimelineGrid'
import { AlbumPickerDialog } from '../components/AlbumPickerDialog'
import { UploadButton } from '../components/UploadButton'
import { getAsset, trashAssets } from '../api/assets'
import { effectiveAssetDate, monthKeyOf } from '../lib/dateFormat'
import { useAppStore } from '../store/app-store'

function TimelineContent() {
  // Structure (buckets, heights, order) comes from the layout endpoint; months fill it in.
  const { groups, monthStatus, ensureMonth, refreshKey } = useTimelineMonths()
  const timeline = useTimelineLayout()
  const bumpTimelineRefresh = useAppStore((s) => s.bumpTimelineRefresh)
  const loadedAssets = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // One refresh signal: layout refetches itself, months re-check their stamps and the grid
  // re-triggers ensureMonth for whatever is on screen (uploads bump this too, via lib/upload).
  const refresh = bumpTimelineRefresh

  // The layout list is effective-date desc over the WHOLE library — its ends tell us whether
  // more items exist beyond the loaded set, and its ordered timestamps pick the adjacent month.
  const newestT = timeline.layoutItems[0]?.t ?? null
  const oldestT = timeline.layoutItems[timeline.layoutItems.length - 1]?.t ?? null

  const hasBeyond = useCallback(
    (dir: 'prev' | 'next', fromT: string) =>
      dir === 'next' ? oldestT !== null && oldestT < fromT : newestT !== null && newestT > fromT,
    [newestT, oldestT],
  )

  const resolveBeyond = useCallback(
    async (dir: 'prev' | 'next', fromT: string): Promise<Asset | null> => {
      // layout is effective-date desc → closest older = first below, closest newer = last above
      const candidates = timeline.layoutItems.filter((item) =>
        dir === 'next' ? item.t < fromT : item.t > fromT,
      )
      const boundaryItem = dir === 'next' ? candidates[0] : candidates.at(-1)
      if (!boundaryItem) return null
      const monthItems = await ensureMonth(monthKeyOf(boundaryItem.t))
      if (!monthItems) return null
      // the adjacent item inside the freshly loaded month = the one right next to `fromT`
      return dir === 'next'
        ? (monthItems.find((a) => effectiveAssetDate(a) < fromT) ?? null)
        : (monthItems.filter((a) => effectiveAssetDate(a) > fromT).at(-1) ?? null)
    },
    [timeline.layoutItems, ensureMonth],
  )

  // Deep link (?asset=<id>) to an asset whose month isn't fetched: fetch the asset itself so
  // the viewer opens instead of waiting for a month that may never enter the mount window.
  const resolveMissing = useCallback(async (id: string): Promise<Asset | null> => {
    try {
      return await getAsset(id)
    } catch {
      return null
    }
  }, [])

  const nav = useAssetNavigation({
    assets: loadedAssets,
    hasBeyond,
    resolveBeyond,
    resolveMissing,
    onAfterAction: refresh,
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const handleBulkTrash = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(`Move ${ids.length} item${ids.length > 1 ? 's' : ''} to trash?`)) return
    try {
      await trashAssets(ids)
      clearSelection()
      refresh()
    } catch {
      window.alert('Failed to move items to trash. Please try again.')
    }
  }

  const onClickAsset = (asset: Asset) => {
    if (selectedIds.size > 0) toggle(asset.id)
    else nav.open(asset)
  }

  const onLongPress = (asset: Asset) => {
    setSelectedIds((prev) => new Set(prev).add(asset.id))
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10)
  }

  // Gate: layout drives structure. ponytail: a layout failure (first load OR refresh) lands on
  // the error state — no partial-track fallback, since every height depends on it; Reload retries.
  if (timeline.error)
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <p className="text-red-500 text-sm">{timeline.error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-primary text-sm font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    )

  if (timeline.loading)
    return (
      <div className="flex items-center justify-center py-32">
        <FaSpinner className="text-2xl text-primary animate-spin" />
      </div>
    )

  if (timeline.layout.buckets.length === 0)
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-lg mx-auto">
        <div className="mb-12 relative w-64 h-64 flex items-center justify-center">
          <div className="absolute inset-0 bg-primary/5 blur-[100px] rounded-full animate-pulse" />
          <div className="relative w-32 h-32">
            <div className="absolute inset-0 rounded-[32px] bg-[#272a32] border-[#424754]/20 rotate-12 shadow-2xl flex items-center justify-center">
              <FaImage className="text-6xl text-primary opacity-20" />
            </div>
            <div className="absolute -top-4 -left-4 w-32 h-32 rounded-[32px] bg-[#1d1f27] border-[#424754]/20 -rotate-6 shadow-2xl flex items-center justify-center">
              <FaMountain className="text-6xl text-primary opacity-40" />
            </div>
            <div className="absolute -top-8 left-2 w-32 h-32 rounded-[32px] bg-[#32353d] border border-primary/30 shadow-2xl flex items-center justify-center">
              <FaWandMagicSparkles className="text-6xl text-primary" />
            </div>
          </div>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-100 mb-6">
          No memories yet
        </h1>
        <p className="text-slate-400 text-lg leading-relaxed max-w-sm mx-auto mb-10">
          Your timeline is currently empty. Start preserving your life's moments by uploading your
          first batch of photos.
        </p>
        <UploadButton />
      </div>
    )

  return (
    <>
      <TimelineGrid
        layout={timeline.layout}
        containerRef={timeline.containerRef}
        groups={groups}
        monthStatus={monthStatus}
        ensureMonth={ensureMonth}
        refreshKey={refreshKey}
        onSelect={onClickAsset}
        selectedIds={selectedIds}
        onToggleSelect={toggle}
        onLongPress={onLongPress}
        showCheckbox
      />
      {nav.selected && (
        <AssetViewer
          asset={nav.selected}
          onClose={nav.close}
          onPrev={nav.goPrev}
          onNext={nav.goNext}
          hasPrev={nav.hasPrev}
          hasNext={nav.hasNext}
          onTrash={() => {
            void nav.trash()
          }}
          onToggleFavorite={(nextValue) => {
            const cur = nav.selected
            if (cur) void nav.toggleFavorite(cur.id, nextValue)
          }}
          onAddToAlbum={() => {
            const cur = nav.selected
            if (cur) {
              setSelectedIds((prev) => new Set(prev).add(cur.id))
              setPickerOpen(true)
            }
          }}
          siblingAssets={loadedAssets}
          onSelectSibling={(asset) => nav.open(asset)}
        />
      )}
      <AlbumPickerDialog
        open={selectedIds.size > 0 && pickerOpen}
        onClose={() => {
          setPickerOpen(false)
          clearSelection()
        }}
        assetIds={Array.from(selectedIds)}
        onDone={clearSelection}
      />
      <div
        aria-hidden={selectedIds.size === 0 || pickerOpen}
        className={`fixed bottom-0 left-0 right-0 z-40 bg-card-dark/95 backdrop-blur border-t border-border-dark px-4 py-3 flex items-center gap-3 transition-transform duration-300 ease-out ${
          selectedIds.size > 0 && !pickerOpen
            ? 'translate-y-0'
            : 'translate-y-full pointer-events-none'
        }`}
      >
        <span className="text-sm text-slate-300 font-medium shrink-0 truncate">
          {selectedIds.size} selected
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={clearSelection}
          className="text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5 shrink-0"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void handleBulkTrash()
          }}
          className="text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          <FaTrash className="text-xs" />
          Trash
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          <FaFolderPlus className="text-xs" />
          Add to album
        </button>
      </div>
    </>
  )
}

export default function TimelineRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <TimelineContent />
      </AppShell>
    </RequireAuth>
  )
}
