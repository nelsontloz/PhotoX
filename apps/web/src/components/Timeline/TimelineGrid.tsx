import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import type { Asset } from '@photox/shared-types'
import type { AssetGroup } from '../../hooks/useAssetGroups'
import type { MonthStatus, UseTimelineMonthsResult } from '../../hooks/useTimelineMonths'
import type { TimelineLayout } from '../../lib/timelineLayout'
import { groupDateLabelFromSortKey } from '../../lib/dateFormat'
import { GalleryItem } from '../GalleryItem'
import { Skeleton } from '../Skeleton'
import { DropZone } from '../DropZone'
import { ScrollContainerContext } from '../AppShell'
import { TimelineScrollbar } from './TimelineScrollbar'

interface TimelineGridProps {
  layout: TimelineLayout
  containerRef: (el: HTMLDivElement | null) => void
  groups: AssetGroup[]
  monthStatus: ReadonlyMap<string, MonthStatus>
  /** Fetches a month's assets when its bucket enters the mount window (deduped inside the hook) */
  ensureMonth: UseTimelineMonthsResult['ensureMonth']
  /** Bumped by uploads/trash — re-triggers ensureMonth for the currently mounted months */
  refreshKey: number
  onSelect: (asset: Asset) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onLongPress?: (asset: Asset) => void
  showCheckbox?: boolean
}

export function TimelineGrid({
  layout,
  containerRef,
  groups,
  monthStatus,
  ensureMonth,
  refreshKey,
  onSelect,
  selectedIds,
  onToggleSelect,
  onLongPress,
  showCheckbox = true,
}: TimelineGridProps) {
  const selectionMode = selectedIds.size > 0
  const scrollContainer = useContext(ScrollContainerContext)
  const [scrollPos, setScrollPos] = useState({ top: 0, height: 0 })

  // Scroll source = AppShell's <main> — the same container the sticky headers depend on.
  // No container (outside AppShell) → keep {0,0} → every bucket mounts (safe fallback).
  useLayoutEffect(() => {
    const el = scrollContainer?.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      setScrollPos({ top: el.scrollTop, height: el.clientHeight })
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [scrollContainer])

  const groupsByDay = useMemo(() => new Map(groups.map((g) => [g.sortKey, g])), [groups])

  // Mount window: visible range [top, top + h] expanded by one viewport of overscan above and
  // below. Unmounted buckets keep their reserved space (container height + absolute tops).
  const hasViewport = scrollPos.height > 0
  const min = hasViewport ? scrollPos.top - scrollPos.height : Number.NEGATIVE_INFINITY
  const max = hasViewport ? scrollPos.top + scrollPos.height * 2 : Number.POSITIVE_INFINITY
  const mountedBuckets = layout.buckets.filter(
    (bucket) => bucket.top < max && bucket.top + bucket.height > min,
  )
  // ponytail: key the effect off the mounted SET, not the per-render array — ensureMonth
  // re-commits a failed month to 'loading', so a per-render effect would retry it forever.
  const mountedKeys = useMemo(() => mountedBuckets.map((b) => b.key).join(','), [mountedBuckets])

  // Fetch rule: every bucket in the mount window, on first measure and whenever refreshKey
  // bumps (so an upload re-fetches only what's on screen). No container → fetch everything,
  // matching the mount-everything DOM fallback above. ensureMonth dedupes per key.
  useEffect(() => {
    if (!scrollContainer) {
      for (const bucket of layout.buckets) void ensureMonth(bucket.key)
      return
    }
    if (!hasViewport || !mountedKeys) return
    for (const key of mountedKeys.split(',')) void ensureMonth(key)
  }, [mountedKeys, ensureMonth, refreshKey, scrollContainer, hasViewport, layout.buckets])

  return (
    <DropZone className="h-full">
      {/* fixed overlay — inside DropZone so file drops onto the strip still reach its handlers */}
      <TimelineScrollbar layout={layout} scrollPos={scrollPos} />
      <div
        ref={containerRef}
        className="max-w-6xl mx-auto relative"
        style={{ height: layout.totalHeight }}
      >
        {mountedBuckets.map((bucket) => (
          <section
            key={bucket.key}
            className="absolute left-0 right-0 flow-root"
            style={{ top: bucket.top, height: bucket.height }}
          >
            {bucket.days.map((day) => {
              const group = groupsByDay.get(day.sortKey)
              const monthReady = monthStatus.get(day.sortKey.slice(0, 7)) === 'ready'
              const items = group?.items ?? []
              const allSelected =
                items.length > 0 && items.every((item) => selectedIds.has(item.id))
              return (
                // height comes from layout data (not content), so a day whose assets haven't
                // landed yet still reserves its exact block under the sticky header
                <section
                  key={day.sortKey}
                  className="mb-10 last:mb-0"
                  style={{ height: day.height }}
                >
                  <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-transparent dark:border-transparent transition-all">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                      {group ? group.label : groupDateLabelFromSortKey(day.sortKey)}
                    </h2>
                    {items.length > 0 && (
                      <div className="ml-auto flex items-center">
                        <button
                          type="button"
                          onClick={() => {
                            const target = !allSelected
                            items.forEach((item) => {
                              // flip only items whose state differs from the target
                              if (selectedIds.has(item.id) !== target) {
                                onToggleSelect(item.id)
                              }
                            })
                          }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                        >
                          {allSelected ? 'Deselect all' : 'Select all'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div
                    className="justified-grid-gallery fixed-row-gallery"
                    aria-hidden={!group && !monthReady}
                  >
                    {group
                      ? items.map((asset) => (
                          <GalleryItem
                            key={asset.id}
                            asset={asset}
                            onSelect={onSelect}
                            selected={selectedIds.has(asset.id)}
                            onToggleSelect={onToggleSelect}
                            onLongPress={onLongPress}
                            showCheckbox={showCheckbox}
                            selectionMode={selectionMode}
                          />
                        ))
                      : monthReady
                        ? null // month fetched but this day has no assets — nothing to pack
                        : // skeletons: same --width/--height inputs as GalleryItem, so they pack
                          // into the exact rows the layout reserved (zero shift), non-interactive
                          day.items.map((item, i) => (
                            <figure
                              key={`${day.sortKey}-${i}`}
                              style={
                                { '--width': item.w ?? 1, '--height': item.h ?? 1 } as CSSProperties
                              }
                            >
                              <Skeleton className="w-full h-full" />
                            </figure>
                          ))}
                  </div>
                </section>
              )
            })}
          </section>
        ))}
      </div>
    </DropZone>
  )
}
