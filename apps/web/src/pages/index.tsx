import { lazy, Suspense } from 'react'
import { RequireAuth } from '../components/RequireAuth'
import { AppShell } from '../components/AppShell'
import { useAssetGroups } from '../hooks/useAssetGroups'
import { useAssetNavigation } from '../hooks/useAssetNavigation'
import { TimelineSkeleton } from '../components/Timeline/TimelineSkeleton'
import { TimelineError } from '../components/Timeline/TimelineError'
import { TimelineEmpty } from '../components/Timeline/TimelineEmpty'
import { TimelineGrid } from '../components/Timeline/TimelineGrid'

const AssetViewer = lazy(() =>
  import('../components/AssetViewer/AssetViewer').then((m) => ({ default: m.AssetViewer })),
)

function TimelineContent() {
  const { groups, loading, error, refresh } = useAssetGroups()
  const nav = useAssetNavigation({
    assets: groups.flatMap((g) => g.items),
    onAfterAction: refresh,
  })

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
      <TimelineGrid groups={groups} onSelect={nav.open} />
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
          />
        </Suspense>
      )}
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
