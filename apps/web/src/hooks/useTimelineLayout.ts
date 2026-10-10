import { getAssetLayout, type AssetFilters } from '../api/assets'
import type { TimelineItem, TimelineLayout } from '../lib/timelineLayout'
import { useAppStore } from '../store/app-store'
import { useAsyncFetch } from './useAsyncFetch'
import { useGridLayout } from './useGridLayout'

const EMPTY: TimelineItem[] = []

interface UseTimelineLayoutResult {
  layout: TimelineLayout
  /** Raw layout-endpoint items in effective-date desc order — used for viewer navigation beyond the loaded months */
  layoutItems: TimelineItem[]
  containerRef: (el: HTMLDivElement | null) => void
  loading: boolean
  error: string | null
}

/**
 * Fetches the full-timeline layout (`/v1/assets/layout`) and derives the reserved month buckets
 * for virtualized rendering. The layout endpoint is the SINGLE source of bucket/day heights:
 * `buildBuckets` always feeds on its items, and `useTimelineMonths` fills the day sections in
 * behind them (identical aspect inputs → identical rows, so no shift).
 * ponytail: there is deliberately no rebuild-from-actual-assets path — partial month data would
 * shrink the reserved track as months land. Upgrade path: rebuild only if every month is loaded.
 * Layout fetch failure → the page's error state (no partial-track fallback).
 */
export function useTimelineLayout(filters: AssetFilters = {}): UseTimelineLayoutResult {
  const timelineRefreshKey = useAppStore((s) => s.timelineRefreshKey)

  const { data, loading, error } = useAsyncFetch(() => getAssetLayout(filters), {
    refreshKey: timelineRefreshKey,
    errorMessage: 'Failed to load timeline layout',
  })
  const layoutItems = data?.items ?? EMPTY
  const { layout, containerRef } = useGridLayout(layoutItems)

  return { layout, layoutItems, containerRef, loading, error }
}
