import { useCallback } from 'react'
import type { Asset } from '@photox/shared-types'
import { getAsset } from '../api/assets'
import { effectiveAssetDate, monthKeyOf } from '../lib/dateFormat'
import type { TimelineItem } from '../lib/timelineLayout'

/**
 * Beyond-the-loaded-set navigation wiring shared by every timeline-backed page (home, favorites,
 * person, album). The layout list is effective-date desc over the page's WHOLE filtered set —
 * its ends tell us whether more items exist beyond the loaded months, and its ordered timestamps
 * pick the adjacent month to fetch.
 */
export function useTimelineNav({
  layoutItems,
  ensureMonth,
}: {
  layoutItems: TimelineItem[]
  ensureMonth: (monthKey: string) => Promise<Asset[] | null>
}): {
  hasBeyond: (dir: 'prev' | 'next', fromT: string) => boolean
  resolveBeyond: (dir: 'prev' | 'next', fromT: string) => Promise<Asset | null>
  resolveMissing: (id: string) => Promise<Asset | null>
} {
  const newestT = layoutItems[0]?.t ?? null
  const oldestT = layoutItems[layoutItems.length - 1]?.t ?? null

  const hasBeyond = useCallback(
    (dir: 'prev' | 'next', fromT: string) =>
      dir === 'next' ? oldestT !== null && oldestT < fromT : newestT !== null && newestT > fromT,
    [newestT, oldestT],
  )

  const resolveBeyond = useCallback(
    async (dir: 'prev' | 'next', fromT: string): Promise<Asset | null> => {
      // layout is effective-date desc → closest older = first below, closest newer = last above
      const candidates = layoutItems.filter((item) =>
        dir === 'next' ? item.t < fromT : item.t > fromT,
      )
      const boundaryItem = dir === 'next' ? candidates[0] : candidates.at(-1)
      if (!boundaryItem) return null
      const monthItems = await ensureMonth(monthKeyOf(boundaryItem.t))
      if (!monthItems) return null
      // the adjacent item inside the freshly loaded month = the one right next to `fromT`
      return dir === 'next'
        ? (monthItems.find((a) => effectiveAssetDate(a) < fromT) ?? null)
        : (monthItems.filter((a) => effectiveAssetDate(a) > fromT).at(-1) ?? null)
    },
    [layoutItems, ensureMonth],
  )

  // Deep link (?asset=<id>) to an asset whose month isn't fetched: fetch the asset itself so
  // the viewer opens instead of waiting for a month that may never enter the mount window.
  const resolveMissing = useCallback(async (id: string): Promise<Asset | null> => {
    try {
      return await getAsset(id)
    } catch {
      return null
    }
  }, [])

  return { hasBeyond, resolveBeyond, resolveMissing }
}
