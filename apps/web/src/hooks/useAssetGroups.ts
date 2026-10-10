import type { Asset } from '@photox/shared-types'
import { groupDateLabel, groupDateSortKey } from '../lib/dateFormat'

export interface AssetGroup {
  label: string
  sortKey: string
  items: Asset[]
}

/**
 * Sorts assets by their date descending and buckets them into day groups (`groupDateSortKey`).
 * Shared by the trash fetch-all hook and the timeline's per-month cache.
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
