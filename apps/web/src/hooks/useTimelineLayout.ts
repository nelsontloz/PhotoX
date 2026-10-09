import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getAssetLayout } from '../api/assets'
import { buildBuckets } from '../lib/timelineLayout'
import type { TimelineItem, TimelineLayout } from '../lib/timelineLayout'
import { useAppStore } from '../store/app-store'

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
export function useTimelineLayout(): UseTimelineLayoutResult {
  const timelineRefreshKey = useAppStore((s) => s.timelineRefreshKey)
  const [layoutItems, setLayoutItems] = useState<TimelineItem[]>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [rowHeight, setRowHeight] = useState(0)
  const fetchIdRef = useRef(0)
  const loadedOnceRef = useRef(false)
  // dedupe same-refresh-key fetches already in flight (StrictMode dev double-mount)
  const inFlightKeyRef = useRef<number | null>(null)
  const containerElRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)

  const fetchLayout = async () => {
    const key = timelineRefreshKey
    if (inFlightKeyRef.current === key) return
    inFlightKeyRef.current = key
    const fetchId = ++fetchIdRef.current
    try {
      // ponytail: only the first load gates the page; refreshes update in place
      if (!loadedOnceRef.current) setLoading(true)
      setError(null)
      const data = await getAssetLayout()
      if (fetchId !== fetchIdRef.current) return
      setLayoutItems(data.items)
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return
      setError((err as Error).message ?? 'Failed to load timeline layout')
    } finally {
      if (fetchId === fetchIdRef.current) {
        loadedOnceRef.current = true
        setLoading(false)
        inFlightKeyRef.current = null
      }
    }
  }

  useEffect(() => {
    void fetchLayout()
  }, [timelineRefreshKey])

  // ONE ResizeObserver on the grid container + a hidden probe carrying `.fixed-row-gallery`, so
  // rowHeight always comes from computed CSS. Never branch on `innerWidth < 640`: the media
  // query is `40rem`, which diverges from px when the user's root font-size isn't 16px.
  useLayoutEffect(() => {
    const probe = document.createElement('div')
    probe.className = 'justified-grid-gallery fixed-row-gallery'
    probe.style.cssText =
      'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none'
    document.body.appendChild(probe)
    const readRowHeight = () => {
      const px = parseFloat(getComputedStyle(probe).getPropertyValue('--row-height'))
      setRowHeight(Number.isFinite(px) ? px : 0)
    }
    readRowHeight()

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
      readRowHeight()
    })
    roRef.current = ro
    if (containerElRef.current) ro.observe(containerElRef.current)

    const onResize = () => readRowHeight()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      roRef.current = null
      probe.remove()
    }
  }, [])

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    containerElRef.current = el
    if (el) {
      // measured during commit so the first paint already has real widths (the RO below covers later changes)
      setContainerWidth(el.getBoundingClientRect().width)
      roRef.current?.observe(el)
    } else {
      roRef.current?.disconnect()
    }
  }, [])

  const layout = useMemo(
    () => buildBuckets(layoutItems, { containerWidth, rowHeight }),
    [layoutItems, containerWidth, rowHeight],
  )

  return { layout, layoutItems, containerRef, loading, error }
}
