import { useState } from 'react'
import { FaHeart } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { GalleryItem } from '../../components/GalleryItem'
import { AssetViewer } from '../../components/AssetViewer/AssetViewer'
import { AlbumPickerDialog } from '../../components/AlbumPickerDialog'
import { useAssetGroups } from '../../hooks/useAssetGroups'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

function FavoritesContent() {
  const { groups, loading, error, refresh } = useAssetGroups({ favorite: true })
  const [pickerOpen, setPickerOpen] = useState(false)
  const nav = useAssetNavigation({
    assets: groups.flatMap((g) => g.items),
    onAfterAction: refresh,
  })

  if (loading) {
    return <LoadingState />
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<FaHeart className="text-4xl text-red-500 dark:text-red-400" />}
        circleClassName="bg-red-500/10 dark:bg-red-500/15 ring-1 ring-red-500/25"
        title="No favorites yet"
        body="Photos you mark with a heart will appear here."
      />
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      {groups.map((group) => (
        <section key={group.sortKey} className="mb-10">
          <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-transparent dark:border-transparent transition-all">
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
            onToggleFavorite={(nextValue) => {
              const cur = nav.selected
              if (cur) void nav.toggleFavorite(cur.id, nextValue)
            }}
            onAddToAlbum={() => setPickerOpen(true)}
            siblingAssets={groups.flatMap((g) => g.items)}
            onSelectSibling={(asset) => nav.open(asset)}
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
