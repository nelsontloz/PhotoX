import { useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { listAssets } from '../api/assets'
import { groupDateLabel, groupDateSortKey } from '../lib/dateFormat'

export interface AssetGroup {
  label: string
  sortKey: string
  items: Asset[]
}

const PAGE_SIZE = 50

export function useAssetGroups() {
  const [groups, setGroups] = useState<AssetGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchAssets() {
      try {
        setLoading(true)
        setError(null)

        const all: Asset[] = []
        let offset = 0
        let total = 0

        do {
          const res = await listAssets({ limit: PAGE_SIZE, offset })
          all.push(...res.items)
          total = res.total
          offset += PAGE_SIZE
        } while (offset < total && !cancelled)

        if (cancelled) return

        const sorted = all
          .filter((a) => a.takenAt ?? a.uploadedAt)
          .sort((a, b) => {
            const da = new Date(a.takenAt ?? a.uploadedAt ?? '')
            const db = new Date(b.takenAt ?? b.uploadedAt ?? '')
            return db.getTime() - da.getTime()
          })

        const map = new Map<string, Asset[]>()
        for (const asset of sorted) {
          const dateStr = asset.takenAt ?? asset.uploadedAt ?? ''
          const key = groupDateSortKey(dateStr)
          if (!map.has(key)) map.set(key, [])
          map.get(key)!.push(asset)
        }

        const grouped: AssetGroup[] = Array.from(map.entries())
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([sortKey, items]) => {
            const representative = items[0]!
            const dateStr = representative.takenAt ?? representative.uploadedAt ?? ''
            return {
              label: groupDateLabel(dateStr),
              sortKey,
              items,
            }
          })

        setGroups(grouped)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message ?? 'Failed to load assets')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchAssets()
    return () => {
      cancelled = true
    }
  }, [])

  return { groups, loading, error }
}
