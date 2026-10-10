import { useMemo, useState } from 'react'
import { FaHeart } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { TimelineGrid } from '../../components/Timeline/TimelineGrid'
import { ViewerHost } from '../../components/ViewerHost'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { useTimelineLayout } from '../../hooks/useTimelineLayout'
import { useTimelineMonths } from '../../hooks/useTimelineMonths'
import { useTimelineNav } from '../../hooks/useTimelineNav'
import { useAppStore } from '../../store/app-store'

function FavoritesContent() {
  // Same lazy pipeline as the home timeline, filtered to favorites (layout + per-month fetches).
  const timeline = useTimelineLayout({ favorite: true })
  const { groups, monthStatus, ensureMonth, retainMonths, refreshKey } = useTimelineMonths({
    favorite: true,
  })
  const bumpTimelineRefresh = useAppStore((s) => s.bumpTimelineRefresh)
  const loadedAssets = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const navHelpers = useTimelineNav({ layoutItems: timeline.layoutItems, ensureMonth })
  const nav = useAssetNavigation({
    assets: loadedAssets,
    ...navHelpers,
    // un-favoriting in the viewer must refresh the filtered view
    onAfterAction: bumpTimelineRefresh,
  })
  const [pickerOpen, setPickerOpen] = useState(false)

  if (timeline.loading) {
    return <LoadingState />
  }

  if (timeline.error) {
    return <ErrorState message={timeline.error} onRetry={() => window.location.reload()} />
  }

  if (timeline.layout.buckets.length === 0) {
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
    <>
      <TimelineGrid
        layout={timeline.layout}
        containerRef={timeline.containerRef}
        groups={groups}
        monthStatus={monthStatus}
        ensureMonth={ensureMonth}
        retainMonths={retainMonths}
        refreshKey={refreshKey}
        onSelect={nav.open}
      />
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
        siblingAssets={loadedAssets}
        onSelectSibling={(asset) => nav.open(asset)}
        pickerOpen={pickerOpen}
        onPickerClose={() => setPickerOpen(false)}
      />
    </>
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
