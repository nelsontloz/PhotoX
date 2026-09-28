import { useEffect, useRef, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { listAssets } from '../api/assets'
import { groupDateLabel, groupDateSortKey } from '../lib/dateFormat'
import { useAppStore } from '../store/app-store'

export interface AssetGroup {
  label: string
  sortKey: string
  items: Asset[]
}

const PAGE_SIZE = 50

export function useAssetGroups(
  opts: { isTrashed?: boolean; favorite?: boolean; dateField?: 'takenAt' | 'trashedAt' } = {},
) {
  const { isTrashed, favorite, dateField = 'takenAt' } = opts
  const timelineRefreshKey = useAppStore((s) => s.timelineRefreshKey)
  const [groups, setGroups] = useState<AssetGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchIdRef = useRef(0)
  const loadedOnceRef = useRef(false)

  const fetchAssets = async () => {
    const fetchId = ++fetchIdRef.current
    try {
      // ponytail: only the first load blocks the page; refreshes update in place so the viewer isn't unmounted
      if (!loadedOnceRef.current) setLoading(true)
      setError(null)

      const dateOf = (a: Asset) =>
        dateField === 'trashedAt' ? a.trashedAt : (a.takenAt ?? a.uploadedAt)

      const all: Asset[] = []
      let offset = 0
      let total = 0

      do {
        const res = await listAssets({ limit: PAGE_SIZE, offset, isTrashed, favorite })
        all.push(...res.items)
        total = res.total
        offset += PAGE_SIZE
      } while (offset < total)

      if (fetchId !== fetchIdRef.current) return

      const sorted = all
        .filter((a) => dateOf(a))
        .sort((a, b) => {
          const da = new Date(dateOf(a) ?? '')
          const db = new Date(dateOf(b) ?? '')
          return db.getTime() - da.getTime()
        })

      const map = new Map<string, Asset[]>()
      for (const asset of sorted) {
        const dateStr = dateOf(asset) ?? ''
        const key = groupDateSortKey(dateStr)
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(asset)
      }

      const grouped: AssetGroup[] = Array.from(map.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([sortKey, items]) => {
          const representative = items[0]!
          const dateStr = dateOf(representative) ?? ''
          return {
            label: groupDateLabel(dateStr),
            sortKey,
            items,
          }
        })

      setGroups(grouped)
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return
      setError((err as Error).message ?? 'Failed to load assets')
    } finally {
      if (fetchId === fetchIdRef.current) {
        loadedOnceRef.current = true
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void fetchAssets()
  }, [timelineRefreshKey])

  return { groups, loading, error, refresh: fetchAssets }
}
