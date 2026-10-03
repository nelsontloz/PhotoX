import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FaMagnifyingGlass } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { GalleryItem } from '../../components/GalleryItem'
import { AssetViewer } from '../../components/AssetViewer/AssetViewer'
import { AlbumPickerDialog } from '../../components/AlbumPickerDialog'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { useSearchStore } from '../../store/search-store'

function SearchContent() {
  const [searchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? '').trim()
  const items = useSearchStore((s) => s.items)
  const total = useSearchStore((s) => s.total)
  const loading = useSearchStore((s) => s.loading)
  const loadingMore = useSearchStore((s) => s.loadingMore)
  const error = useSearchStore((s) => s.error)
  const run = useSearchStore((s) => s.run)
  const loadMore = useSearchStore((s) => s.loadMore)
  const reset = useSearchStore((s) => s.reset)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (q) void run(q)
    else reset()
  }, [q, run, reset])

  const nav = useAssetNavigation({
    assets: items,
    onAfterAction: () => run(q, true),
  })

  if (!q) {
    return (
      <EmptyState
        icon={<FaMagnifyingGlass className="text-4xl text-primary" />}
        circleClassName="bg-primary/10 ring-1 ring-primary/25"
        title="Search your library"
        body="Type in the search bar to find photos and videos."
      />
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white break-words">
          Results for “{q}”
        </h1>
        {!loading && !error && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {total} {total === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>

      {loading ? (
        <LoadingState />
      ) : error && items.length === 0 ? (
        <ErrorState message={error} onRetry={() => void run(q, true)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FaMagnifyingGlass className="text-4xl text-primary" />}
          circleClassName="bg-primary/10 ring-1 ring-primary/25"
          title={`No results for “${q}”`}
          body="Try a different word or check the spelling."
        />
      ) : (
        <>
          <div className="justified-grid-gallery">
            {items.map((asset) => (
              <GalleryItem key={asset.id} asset={asset} onSelect={nav.open} />
            ))}
          </div>
          {(items.length < total || error) && (
            <div className="flex flex-col items-center gap-3 mt-8">
              {error && <p className="text-sm text-rose-400">{error}</p>}
              {items.length < total && (
                <>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Showing {items.length} of {total}
                  </p>
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                    className="text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-card-dark border border-gray-200 dark:border-border-dark hover:border-primary/40 disabled:opacity-60 rounded-lg px-4 py-2 transition-colors"
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {nav.selected && (
        <>
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
            onAddToAlbum={() => setPickerOpen(true)}
            siblingAssets={items}
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

export default function SearchPage() {
  return (
    <RequireAuth>
      <AppShell>
        <SearchContent />
      </AppShell>
    </RequireAuth>
  )
}
