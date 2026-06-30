import { useState } from 'react'
import { FaHeart, FaSpinner } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { GalleryItem } from '../../components/GalleryItem'
import { AssetViewer } from '../../components/AssetViewer/AssetViewer'
import { AlbumPickerDialog } from '../../components/AlbumPickerDialog'
import { useAssetGroups } from '../../hooks/useAssetGroups'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'

function FavoritesContent() {
  const { groups, loading, error, refresh } = useAssetGroups({ favorite: true })
  const [pickerOpen, setPickerOpen] = useState(false)
  const nav = useAssetNavigation({
    assets: groups.flatMap((g) => g.items),
    onAfterAction: refresh,
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <FaSpinner className="text-2xl text-primary animate-spin" />
      </div>
    )
  }

  if (error) {
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
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-lg mx-auto">
        <div className="mb-8 w-20 h-20 rounded-full bg-red-500/10 dark:bg-red-500/15 ring-1 ring-red-500/25 flex items-center justify-center">
          <FaHeart className="text-4xl text-red-500 dark:text-red-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          No favorites yet
        </h1>
        <p className="mt-4 text-slate-500 dark:text-slate-400 text-base sm:text-lg leading-relaxed max-w-md">
          Photos you mark with a heart will appear here.
        </p>
      </div>
    )
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.sortKey} className="mb-10">
          <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-transparent dark:border-transparent transition-all">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {group.label}
            </h2>
          </div>
          <div className="justified-grid-gallery">
            {group.items.map((asset) => {
              return <GalleryItem key={asset.id} asset={asset} onSelect={nav.open} />
            })}
          </div>
        </section>
      ))}
      {nav.selected && (
        <>
          <AssetViewer
            asset={nav.selected}
            onClose={nav.close}
            onPrev={nav.goPrev}
            onNext={nav.goNext}
            hasPrev={nav.hasPrev}
            hasNext={nav.hasNext}
            onToggleFavorite={() => {
              const cur = nav.selected
              if (cur) void nav.toggleFavorite(cur.id, !cur.favorite)
            }}
            onAddToAlbum={() => setPickerOpen(true)}
          />
          <AlbumPickerDialog
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            assetIds={[nav.selected.id]}
          />
        </>
      )}
    </div>
  )
}

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <AppShell>
        <FavoritesContent />
      </AppShell>
    </RequireAuth>
  )
}
