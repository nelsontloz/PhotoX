import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildBuckets } from '../lib/timelineLayout'
import type { TimelineItem, TimelineLayout } from '../lib/timelineLayout'

interface UseGridLayoutResult {
  layout: TimelineLayout
  containerRef: (el: HTMLDivElement | null) => void
}

/**
 * Measurement half of the timeline layout: container width + computed `--row-height` feed
 * `buildBuckets` over caller-supplied items. The layout is the SINGLE source of bucket/day
 * heights: the grid renders skeleton sections from it and fills the days in behind it
 * (identical aspect inputs → identical rows, so no shift).
 */
export function useGridLayout(items: readonly TimelineItem[]): UseGridLayoutResult {
  const [containerWidth, setContainerWidth] = useState(0)
  const [rowHeight, setRowHeight] = useState(0)
  const containerElRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)

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
    () => buildBuckets(items, { containerWidth, rowHeight }),
    [items, containerWidth, rowHeight],
  )

  return { layout, containerRef }
}
