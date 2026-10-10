import { useCallback, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { FaFolderPlus, FaImage, FaMountain, FaTrash, FaWandMagicSparkles } from 'react-icons/fa6'
import { RequireAuth } from '../components/RequireAuth'
import { AppShell } from '../components/AppShell'
import { useConfirm } from '../components/ConfirmProvider'
import { ErrorState, LoadingState } from '../components/StateViews'
import { ViewerHost } from '../components/ViewerHost'
import { useAssetNavigation } from '../hooks/useAssetNavigation'
import { useTimelineView } from '../hooks/useTimelineView'
import { TimelineAssets } from '../components/Timeline/TimelineAssets'
import { DropZone } from '../components/DropZone'
import { UploadButton } from '../components/UploadButton'
import { trashAssets } from '../api/assets'
import { useAppStore } from '../store/app-store'

function TimelineContent() {
  const confirm = useConfirm()
  // Structure (buckets, heights, order) comes from the layout endpoint; months fill it in.
  const view = useTimelineView()
  const { timeline, loadedAssets, navHelpers } = view
  const bumpTimelineRefresh = useAppStore((s) => s.bumpTimelineRefresh)

  // One refresh signal: layout refetches itself, months re-check their stamps and the grid
  // re-triggers ensureMonth for whatever is on screen (uploads bump this too, via lib/upload).
  const refresh = bumpTimelineRefresh

  const nav = useAssetNavigation({
    assets: loadedAssets,
    ...navHelpers,
    onAfterAction: refresh,
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const handleBulkTrash = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (
      !(await confirm({
        title: `Move ${ids.length} item${ids.length > 1 ? 's' : ''} to trash?`,
        destructive: true,
      }))
    )
      return
    try {
      await trashAssets(ids)
      clearSelection()
      refresh()
    } catch {
      window.alert('Failed to move items to trash. Please try again.')
    }
  }

  // stable handler identities: memoized GalleryItems must bail out on unrelated re-renders
  const selectionMode = selectedIds.size > 0
  const onClickAsset = useCallback(
    (asset: Asset) => {
      if (selectionMode) toggle(asset.id)
      else nav.open(asset)
    },
    [selectionMode, toggle, nav.open],
  )

  const onLongPress = useCallback((asset: Asset) => {
    setSelectedIds((prev) => new Set(prev).add(asset.id))
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10)
  }, [])

  // Gate: layout drives structure. ponytail: a layout failure (first load OR refresh) lands on
  // the error state — no partial-track fallback, since every height depends on it; Reload retries.
  if (timeline.error)
    return <ErrorState message={timeline.error} onRetry={() => window.location.reload()} />

  if (timeline.loading) return <LoadingState />

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
      <DropZone className="h-full">
        {/* fixed overlay — inside DropZone so file drops onto the strip still reach its handlers */}
        <TimelineAssets
          view={view}
          onSelect={onClickAsset}
          selectedIds={selectedIds}
          onToggleSelect={toggle}
          onLongPress={onLongPress}
        />
      </DropZone>
      <ViewerHost
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
        pickerOpen={selectedIds.size > 0 && pickerOpen}
        onPickerClose={() => {
          setPickerOpen(false)
          clearSelection()
        }}
        pickerAssetIds={Array.from(selectedIds)}
        onPickerDone={clearSelection}
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
