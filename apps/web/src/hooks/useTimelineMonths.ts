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

/** Bounded cache cap — see the eviction comment in `commit` for the tradeoff. */
export const MAX_CACHED_MONTHS = 12

export interface UseTimelineMonthsResult {
  /** Day groups merged across every fetched month (stale months included, so refreshes don't unmount the viewer) */
  groups: AssetGroup[]
  monthStatus: ReadonlyMap<string, MonthStatus>
  /** Fetches one month's assets (deduped, idempotent); resolves with the month's items or null on error/stale */
  ensureMonth: (monthKey: string) => Promise<Asset[] | null>
  /**
   * Marks months as in use: retained (never evicted) and touched for LRU. Ref-only — calling it
   * does not re-render.
   */
  retainMonths: (keys: readonly string[]) => void
  /** Current `timelineRefreshKey` — bumping it makes TimelineGrid re-trigger ensureMonth for visible months */
  refreshKey: number
}

/**
 * Per-month asset cache for the timeline: nothing is fetched at mount, `ensureMonth('YYYY-MM')`
 * fetches the whole month through `listAllAssets` (limit 100) inside its half-open
 * `dateFrom`/`dateTo` range, and entries are stamped with the refresh key so an upload/trash bump
 * re-fetches only what's on screen. Favorites/trash keep `useAssetGroups`' fetch-all.
 *
 * The cache is bounded: past MAX_CACHED_MONTHS it evicts the least-recently-used month that isn't
 * mounted (`retainMonths`), so evicted months simply re-fetch when they scroll back into view.
 */
export function useTimelineMonths({
  personId,
}: {
  personId?: string
} = {}): UseTimelineMonthsResult {
  const refreshKey = useAppStore((s) => s.timelineRefreshKey)
  const [entries, setEntries] = useState<Map<string, MonthEntry>>(() => new Map())
  // sync mirror of `entries` so ensureMonth reads fresh data without waiting for a re-render
  const entriesRef = useRef(entries)
  const inFlightRef = useRef(new Map<string, { stamp: number; promise: Promise<Asset[] | null> }>())
  // LRU bookkeeping: monotonic touch counter per month + the mounted months protected from eviction
  const lastUsedRef = useRef(new Map<string, number>())
  const counterRef = useRef(0)
  const retainedRef = useRef<ReadonlySet<string>>(new Set())

  const touch = useCallback((key: string) => {
    lastUsedRef.current.set(key, ++counterRef.current)
  }, [])

  const commit = useCallback((key: string, entry: MonthEntry) => {
    // staleness guard: a fetch that finishes after a refresh-key bump writes nothing
    if (entry.stamp !== useAppStore.getState().timelineRefreshKey) return
    const next = new Map(entriesRef.current)
    next.set(key, entry)
    // Evict LRU-beyond-cap, once per commit, never the mounted (retained) months and never the
    // key just committed. ponytail: month-count cap, not a byte budget — 12 heavy months fit
    // comfortably; upgrade path = byte-budget LRU if single months ever get huge.
    if (next.size > MAX_CACHED_MONTHS) {
      const victims = [...next.keys()]
        .filter((k) => k !== key && !retainedRef.current.has(k))
        .sort((a, b) => (lastUsedRef.current.get(a) ?? 0) - (lastUsedRef.current.get(b) ?? 0))
      for (const victim of victims) {
        if (next.size <= MAX_CACHED_MONTHS) break
        next.delete(victim)
      }
    }
    entriesRef.current = next
    setEntries(next)
  }, [])

  const retainMonths = useCallback(
    (keys: readonly string[]) => {
      retainedRef.current = new Set(keys)
      for (const key of keys) touch(key)
    },
    [touch],
  )

  const fetchMonth = useCallback(
    async (key: string): Promise<Asset[] | null> => {
      const stamp = useAppStore.getState().timelineRefreshKey
      try {
        const { dateFrom, dateTo } = monthRange(key)
        const all = await listAllAssets({ limit: PAGE_SIZE, dateFrom, dateTo, personId })
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
    [commit, personId],
  )

  const ensureMonth = useCallback(
    (key: string): Promise<Asset[] | null> => {
      touch(key) // in use: cache hit, in-flight join, or a fresh fetch
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
    [commit, fetchMonth, touch],
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

  return { groups, monthStatus, ensureMonth, retainMonths, refreshKey }
}
