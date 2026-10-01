import { useCallback, useMemo, useRef, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { listAllAssets } from '../api/assets'
import { groupAssetsByDay, type AssetGroup } from './useAssetGroups'
import { effectiveAssetDate, monthRange } from '../lib/dateFormat'
import { useAppStore } from '../store/app-store'

export type MonthStatus = 'loading' | 'ready' | 'error'

interface MonthEntry {
  items: Asset[]
  status: MonthStatus
  /** timelineRefreshKey the entry was fetched under — entries from an older key are refetched on the next ensureMonth */
  stamp: number
}

const PAGE_SIZE = 100

export interface UseTimelineMonthsResult {
  /** Day groups merged across every fetched month (stale months included, so refreshes don't unmount the viewer) */
  groups: AssetGroup[]
  monthStatus: ReadonlyMap<string, MonthStatus>
  /** Fetches one month's assets (deduped, idempotent); resolves with the month's items or null on error/stale */
  ensureMonth: (monthKey: string) => Promise<Asset[] | null>
  /** Current `timelineRefreshKey` — bumping it makes TimelineGrid re-trigger ensureMonth for visible months */
  refreshKey: number
}

/**
 * Per-month asset cache for the timeline: nothing is fetched at mount, `ensureMonth('YYYY-MM')`
 * fetches the whole month through `listAllAssets` (limit 100) inside its half-open
 * `dateFrom`/`dateTo` range, and entries are stamped with the refresh key so an upload/trash bump
 * re-fetches only what's on screen. Favorites/trash keep `useAssetGroups`' fetch-all.
 */
export function useTimelineMonths(): UseTimelineMonthsResult {
  const refreshKey = useAppStore((s) => s.timelineRefreshKey)
  const [entries, setEntries] = useState<Map<string, MonthEntry>>(() => new Map())
  // sync mirror of `entries` so ensureMonth reads fresh data without waiting for a re-render
  const entriesRef = useRef(entries)
  const inFlightRef = useRef(new Map<string, { stamp: number; promise: Promise<Asset[] | null> }>())

  const commit = useCallback((key: string, entry: MonthEntry) => {
    // staleness guard: a fetch that finishes after a refresh-key bump writes nothing
    if (entry.stamp !== useAppStore.getState().timelineRefreshKey) return
    const next = new Map(entriesRef.current)
    next.set(key, entry)
    entriesRef.current = next
    setEntries(next)
  }, [])

  const fetchMonth = useCallback(
    async (key: string): Promise<Asset[] | null> => {
      const stamp = useAppStore.getState().timelineRefreshKey
      try {
        const { dateFrom, dateTo } = monthRange(key)
        const all = await listAllAssets({ limit: PAGE_SIZE, dateFrom, dateTo })
        if (stamp !== useAppStore.getState().timelineRefreshKey) return null
        commit(key, { items: all, status: 'ready', stamp })
        return all
      } catch {
        // ponytail: a failed month retries on the next ensureMonth trigger (scroll back into the
        // bucket / refresh-key bump) — no page-level error UI for one month; a refetch failure
        // keeps the previous items visible instead of dropping to skeletons
        commit(key, { items: entriesRef.current.get(key)?.items ?? [], status: 'error', stamp })
        return null
      }
    },
    [commit],
  )

  const ensureMonth = useCallback(
    (key: string): Promise<Asset[] | null> => {
      const stamp = useAppStore.getState().timelineRefreshKey
      const entry = entriesRef.current.get(key)
      if (entry?.stamp === stamp && entry.status === 'ready') {
        return Promise.resolve(entry.items)
      }
      const existing = inFlightRef.current.get(key)
      // an in-flight fetch under an older refresh key is stale: ignore it and start a fresh one
      if (existing?.stamp === stamp) return existing.promise

      if (!(entry?.stamp === stamp && entry.status === 'loading')) {
        // previous items stay visible while a month refetches (the viewer must not unmount)
        commit(key, { items: entry?.items ?? [], status: 'loading', stamp })
      }
      const promise = fetchMonth(key).finally(() => {
        const current = inFlightRef.current.get(key)
        if (current?.promise === promise) inFlightRef.current.delete(key)
      })
      inFlightRef.current.set(key, { stamp, promise })
      return promise
    },
    [commit, fetchMonth],
  )

  const groups = useMemo(() => {
    const all: Asset[] = []
    for (const entry of entries.values()) all.push(...entry.items)
    return groupAssetsByDay(all, effectiveAssetDate)
  }, [entries])

  const monthStatus = useMemo(() => {
    const status = new Map<string, MonthStatus>()
    for (const [key, entry] of entries) status.set(key, entry.status)
    return status
  }, [entries])

  return { groups, monthStatus, ensureMonth, refreshKey }
}
