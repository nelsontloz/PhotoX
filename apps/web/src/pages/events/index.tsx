import { useEffect, useMemo, useState } from 'react'
import { FaCalendarDays, FaChevronDown, FaSpinner } from 'react-icons/fa6'
import type { Asset, EventGroupDto } from '@photox/shared-types'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { AssetThumb } from '../../components/AssetThumb'
import { GalleryItem } from '../../components/GalleryItem'
import { AssetViewer } from '../../components/AssetViewer/AssetViewer'
import { listEventGroups, listGroupAssets } from '../../api/events'
import { listAssetsByIds } from '../../api/assets'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { formatDate } from '../../lib/dateFormat'

interface GroupItems {
  items: Asset[]
  failed: boolean
}

function dateRangeLabel(from: string, to: string): string {
  const start = formatDate(from)
  const end = formatDate(to)
  return start === end ? start : `${start} – ${end}`
}

function EventsContent() {
  const [groups, setGroups] = useState<EventGroupDto[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [covers, setCovers] = useState<Map<string, Asset>>(new Map())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [groupItems, setGroupItems] = useState<Map<string, GroupItems>>(new Map())
  const [loadingGroupId, setLoadingGroupId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listEventGroups()
      .then((res) => {
        if (cancelled) return
        setGroups(res.groups)
        if (res.groups.length > 0) {
          // groups carry only a cover id — one batched fetch (chunked inside the client)
          void listAssetsByIds(res.groups.map((group) => group.coverAssetId))
            .then((assets) => {
              if (!cancelled) setCovers(new Map(assets.map((asset) => [asset.id, asset])))
            })
            .catch(() => {
              /* cover tiles fall back to a plain placeholder */
            })
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message ?? 'Failed to load events')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadedItems = useMemo(
    () => [...groupItems.values()].flatMap((entry) => entry.items),
    [groupItems],
  )
  const nav = useAssetNavigation({ assets: loadedItems })

  const loadGroup = (group: EventGroupDto) => {
    setLoadingGroupId(group.id)
    listGroupAssets(group)
      .then((items) => {
        setGroupItems((prev) => new Map(prev).set(group.id, { items, failed: false }))
      })
      .catch(() => {
        setGroupItems((prev) => new Map(prev).set(group.id, { items: [], failed: true }))
      })
      .finally(() => {
        setLoadingGroupId((current) => (current === group.id ? null : current))
      })
  }

  const toggleGroup = (group: EventGroupDto) => {
    if (expandedId === group.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(group.id)
    if (!groupItems.has(group.id)) loadGroup(group)
  }

  if (loading) return <LoadingState />

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />
  }

  if (!groups || groups.length === 0) {
    return (
      <EmptyState
        icon={<FaCalendarDays className="text-4xl text-primary" />}
        circleClassName="bg-primary/10 ring-1 ring-primary/25"
        title="No events yet"
        body="Events form from dated, located photos — photos taken close together in time and place group into trips here."
      />
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Events</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {groups.length} {groups.length === 1 ? 'event' : 'events'}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        {groups.map((group) => {
          const expanded = expandedId === group.id
          const entry = groupItems.get(group.id)
          const cover = covers.get(group.coverAssetId)
          return (
            <section
              key={group.id}
              className="self-start rounded-xl overflow-hidden bg-card-dark border border-border-dark"
            >
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={expanded}
                className="group/card relative block w-full aspect-[16/9] overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {cover ? (
                  <AssetThumb
                    asset={cover}
                    className="[&_img]:transition-transform [&_img]:duration-500 [&_img]:ease-out [&_img]:group-hover/card:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 bg-background-dark flex items-center justify-center">
                    <FaCalendarDays className="text-3xl text-slate-700" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
                  <h2 className="font-bold text-white truncate">{group.label}</h2>
                  <p className="text-xs text-white/70 mt-0.5">
                    {dateRangeLabel(group.takenFrom, group.takenTo)} · {group.count}{' '}
                    {group.count === 1 ? 'photo' : 'photos'}
                  </p>
                </div>
                <FaChevronDown
                  className={`absolute top-3 right-3 text-white/70 transition-transform duration-200 ${
                    expanded ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {expanded && (
                <div className="border-t border-border-dark p-4">
                  {loadingGroupId === group.id ? (
                    <div className="flex justify-center py-8">
                      <FaSpinner className="text-xl text-primary animate-spin" />
                    </div>
                  ) : entry?.failed ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-sm text-slate-400">
                      <span>Couldn't load these photos.</span>
                      <button
                        type="button"
                        onClick={() => loadGroup(group)}
                        className="text-primary font-medium hover:underline"
                      >
                        Try again
                      </button>
                    </div>
                  ) : entry && entry.items.length > 0 ? (
                    <div className="justified-grid-gallery">
                      {entry.items.map((asset) => (
                        <GalleryItem key={asset.id} asset={asset} onSelect={nav.open} />
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-slate-500">No photos to show.</p>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {nav.selected && (
        <AssetViewer
          asset={nav.selected}
          onClose={nav.close}
          onPrev={nav.goPrev}
          onNext={nav.goNext}
          hasPrev={nav.hasPrev}
          hasNext={nav.hasNext}
          onToggleFavorite={(nextValue) => {
            const current = nav.selected
            if (current) void nav.toggleFavorite(current.id, nextValue)
          }}
          siblingAssets={loadedItems}
          onSelectSibling={(asset) => nav.open(asset)}
        />
      )}
    </div>
  )
}

export default function EventsPage() {
  return (
    <RequireAuth>
      <AppShell>
        <EventsContent />
      </AppShell>
    </RequireAuth>
  )
}
