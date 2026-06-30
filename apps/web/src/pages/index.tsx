import { lazy, Suspense, useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { FaFolderPlus, FaImage, FaMountain, FaSpinner, FaWandMagicSparkles } from 'react-icons/fa6'
import { RequireAuth } from '../components/RequireAuth'
import { AppShell } from '../components/AppShell'
import { useAssetGroups } from '../hooks/useAssetGroups'
import { useAssetNavigation } from '../hooks/useAssetNavigation'
import { TimelineGrid } from '../components/Timeline/TimelineGrid'
import { AlbumPickerDialog } from '../components/AlbumPickerDialog'
import { UploadButton } from '../components/UploadButton'

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

  if (loading)
    return (
      <div className="flex items-center justify-center py-32">
        <FaSpinner className="text-2xl text-primary animate-spin" />
      </div>
    )
  if (error)
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <p className="text-red-500 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-primary text-sm font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    )
  if (groups.length === 0)
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-lg mx-auto">
        <div className="mb-12 relative w-64 h-64 flex items-center justify-center">
          <div className="absolute inset-0 bg-primary/5 blur-[100px] rounded-full animate-pulse" />
          <div className="relative w-32 h-32">
            <div className="absolute inset-0 rounded-[32px] bg-[#272a32] border border-[#424754]/20 rotate-12 shadow-2xl flex items-center justify-center">
              <FaImage className="text-6xl text-primary opacity-20" />
            </div>
            <div className="absolute -top-4 -left-4 w-32 h-32 rounded-[32px] bg-[#1d1f27] border border-[#424754]/20 -rotate-6 shadow-2xl flex items-center justify-center">
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
        <UploadButton
          onComplete={() => {
            void refresh()
          }}
        />
      </div>
    )

  return (
    <>
      <TimelineGrid
        groups={groups}
        onSelect={onClickAsset}
        selectedIds={selectedIds}
        onToggleSelect={toggle}
        onLongPress={isMobile ? onLongPress : undefined}
        showCheckbox
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
            siblingAssets={groups.flatMap((g) => g.items)}
            onSelectSibling={(asset) => nav.open(asset)}
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
