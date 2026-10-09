import { useCallback } from 'react'
import type { Asset } from '@photox/shared-types'
import { listAllAssets } from '../api/assets'
import { groupDateLabel, groupDateSortKey } from '../lib/dateFormat'
import { useAppStore } from '../store/app-store'
import { useAsyncFetch } from './useAsyncFetch'

export interface AssetGroup {
  label: string
  sortKey: string
  items: Asset[]
}

const PAGE_SIZE = 50
const EMPTY: AssetGroup[] = []

/**
 * Sorts assets by their date descending and buckets them into day groups (`groupDateSortKey`).
 * Shared by the fetch-all hook below and the timeline's per-month cache.
 */
export function groupAssetsByDay(
  items: readonly Asset[],
  dateOf: (a: Asset) => string | null,
): AssetGroup[] {
  const sorted = items
    .map((asset) => {
      const date = dateOf(asset)
      return { asset, date, time: new Date(date ?? '').getTime() }
    })
    .filter((entry) => entry.date)
    .sort((a, b) => b.time - a.time)
    .map((entry) => entry.asset)

  const map = new Map<string, Asset[]>()
  for (const asset of sorted) {
    const dateStr = dateOf(asset) ?? ''
    const key = groupDateSortKey(dateStr)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(asset)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([sortKey, dayItems]) => {
      const representative = dayItems[0]!
      const dateStr = dateOf(representative) ?? ''
      return {
        label: groupDateLabel(dateStr),
        sortKey,
        items: dayItems,
      }
    })
}

export function useAssetGroups(
  opts: { isTrashed?: boolean; favorite?: boolean; dateField?: 'takenAt' | 'trashedAt' } = {},
) {
  const { isTrashed, favorite, dateField = 'takenAt' } = opts
  const timelineRefreshKey = useAppStore((s) => s.timelineRefreshKey)

  const fetchGroups = useCallback(async () => {
    const dateOf = (a: Asset) =>
      dateField === 'trashedAt' ? a.trashedAt : (a.takenAt ?? a.uploadedAt)
    const all = await listAllAssets({ limit: PAGE_SIZE, isTrashed, favorite })
    return groupAssetsByDay(all, dateOf)
  }, [dateField, isTrashed, favorite])

  const { data, loading, error, refresh } = useAsyncFetch(fetchGroups, {
    refreshKey: timelineRefreshKey,
    errorMessage: 'Failed to load assets',
  })

  return { groups: data ?? EMPTY, loading, error, refresh }
}
