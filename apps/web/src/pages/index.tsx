import { lazy, Suspense, useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { FaFolderPlus } from 'react-icons/fa6'
import { RequireAuth } from '../components/RequireAuth'
import { AppShell } from '../components/AppShell'
import { useAssetGroups } from '../hooks/useAssetGroups'
import { useAssetNavigation } from '../hooks/useAssetNavigation'
import { TimelineSkeleton } from '../components/Timeline/TimelineSkeleton'
import { TimelineError } from '../components/Timeline/TimelineError'
import { TimelineEmpty } from '../components/Timeline/TimelineEmpty'
import { TimelineGrid } from '../components/Timeline/TimelineGrid'
import { AlbumPickerDialog } from '../components/AlbumPickerDialog'

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

const AssetViewer = lazy(() =>
  import('../components/AssetViewer/AssetViewer').then((m) => ({ default: m.AssetViewer })),
)

function TimelineContent() {
  const { groups, loading, error, refresh } = useAssetGroups()
  const nav = useAssetNavigation({
    assets: groups.flatMap((g) => g.items),
    onAfterAction: refresh,
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const isMobile = useMediaQuery('(pointer: coarse)')

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const onClickAsset = (asset: Asset) => {
    if (selectedIds.size > 0) toggle(asset.id)
    else nav.open(asset)
  }

  const onLongPress = (asset: Asset) => {
    setSelectedIds((prev) => new Set(prev).add(asset.id))
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10)
  }

  if (loading) return <TimelineSkeleton />
  if (error) return <TimelineError message={error} onRetry={() => window.location.reload()} />
  if (groups.length === 0)
    return (
      <TimelineEmpty
        onUploadComplete={() => {
          void refresh()
        }}
      />
    )

  return (
    <>
      <TimelineGrid
        groups={groups}
        onSelect={onClickAsset}
        selectedIds={selectedIds}
        onToggleSelect={toggle}
        onLongPress={isMobile ? onLongPress : undefined}
        showCheckbox={!isMobile}
      />
      {nav.selected && (
        <Suspense fallback={null}>
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
            onToggleFavorite={() => {
              const cur = nav.selected
              if (cur) void nav.toggleFavorite(cur.id, !cur.favorite)
            }}
            onAddToAlbum={() => {
              const cur = nav.selected
              if (cur) {
                setSelectedIds((prev) => new Set(prev).add(cur.id))
                setPickerOpen(true)
              }
            }}
          />
        </Suspense>
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
