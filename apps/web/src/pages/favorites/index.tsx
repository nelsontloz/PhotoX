import { useState } from 'react'
import { FaHeart } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { DayGroups } from '../../components/DayGroups'
import { ViewerHost } from '../../components/ViewerHost'
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
      <DayGroups groups={groups} onSelect={nav.open} />
      <ViewerHost
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
        pickerOpen={pickerOpen}
        onPickerClose={() => setPickerOpen(false)}
      />
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
