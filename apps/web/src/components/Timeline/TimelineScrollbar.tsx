import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useScrollContainer } from '../AppShell'
import { monthYearLabel } from '../../lib/dateFormat'
import type { TimelineBucket, TimelineLayout } from '../../lib/timelineLayout'

const RAIL_INSET = 16 // rail top/bottom padding inside the strip
const MIN_THUMB_H = 32
const GRACE_MS = 1000 // how long the popup lingers after the last scroll step

/** Geometry inputs of the chronological scrollbar (three coordinate spaces, all in px): */
export interface ScrollbarMetrics {
  /** rail height inside the strip (strip height − 2 × RAIL_INSET); rail coords run 0..trackH */
  trackH: number
  /** scroll container scrollHeight — timeline content + <main>'s padding */
  scrollH: number
  /** scroll container clientHeight (=== strip height) */
  clientH: number
  /** <main>'s top padding: content starts this far below scroll offset 0 */
  padTop: number
}

/**
 * Content offset → rail offset. Deliberately the same affine map the thumb uses, so a bucket's
 * tick and the thumb's top edge coincide exactly when that bucket sits at the top of the viewport.
 */
export function railYForContentY(contentY: number, m: ScrollbarMetrics): number {
  if (m.scrollH <= 0) return 0
  return Math.min(m.trackH, Math.max(0, ((m.padTop + contentY) / m.scrollH) * m.trackH))
}

/** Thumb rectangle on the rail — proportional to the viewport, floored at MIN_THUMB_H. */
export function thumbGeometry(
  scrollTop: number,
  m: ScrollbarMetrics,
): { top: number; height: number } {
  if (m.trackH <= 0 || m.scrollH <= 0) return { top: 0, height: 0 }
  const height = Math.min(Math.max(MIN_THUMB_H, (m.clientH / m.scrollH) * m.trackH), m.trackH)
  const top = Math.min((scrollTop / m.scrollH) * m.trackH, m.trackH - height)
  return { top: Math.max(0, top), height }
}

/**
 * Rail offset → scrollTop, center-mapping: whatever sits under the pointer/thumb centre is placed
 * at the viewport centre, so the popup month (read at the viewport centre) is the one being
 * scrubbed — and railYForContentY(c) round-trips to c + padTop − clientH/2.
 */
export function scrollTopForRailY(railY: number, m: ScrollbarMetrics): number {
  if (m.trackH <= 0 || m.scrollH <= 0) return 0
  const raw = (railY / m.trackH) * m.scrollH - m.clientH / 2
  return Math.min(Math.max(raw, 0), Math.max(0, m.scrollH - m.clientH))
}

/**
 * Month bucket covering a content offset — linear because the popup needs one lookup per frame
 * and a personal library holds at most a few hundred month buckets.
 */
export function monthAtContentY(buckets: readonly TimelineBucket[], contentY: number): string {
  let key = buckets[0]?.key ?? ''
  for (const bucket of buckets) {
    if (contentY < bucket.top) break
    key = bucket.key
  }
  return key
}

interface TimelineScrollbarProps {
  layout: TimelineLayout
  /** rAF-throttled { scrollTop, clientHeight } of the scroll container (from TimelineGrid) */
  scrollPos: { top: number; height: number }
}

/** Viewport-relative box of the scroll container — fixed-position coordinates of the strip. */
interface StripBox {
  top: number
  height: number
  right: number
}

/**
 * Timeline-only scroll affordance: hides the native scrollbar (scoped via the `.timeline-scroll`
 * class toggled on the scroll container) and draws a chronological indicator — a rail with a tick
 * per month bucket at its real layout position (January ticks longer + primary = year boundaries),
 * a draggable thumb, and a "Month Year" popup while scrolling (1s grace), hovering, or scrubbing.
 * Fixed, anchored to the measured box of the scroll container: over <main>'s right padding on
 * pages, over the Add-photos dialog scroller's px-8 padding inside the modal — never over content.
 */
export function TimelineScrollbar({ layout, scrollPos }: TimelineScrollbarProps) {
  const container = useScrollContainer()
  const [metrics, setMetrics] = useState<ScrollbarMetrics | null>(null)
  const [box, setBox] = useState<StripBox | null>(null)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const lastTopRef = useRef(scrollPos.top)
  const dragRef = useRef<{ grab: number } | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // Hide the native bar only while the timeline is mounted, and (re)measure the mapping inputs:
  // scrollHeight/clientHeight move with layout rebuilds and viewport resizes, while the fixed
  // strip anchors to the container box — AppShell's <main> on pages, the dialog scroller in the
  // Add-photos modal. A ResizeObserver on the container catches both (window resizes included,
  // <main> being flex-1), so a dialog panel that grows/shrinks re-anchors without a window resize.
  useLayoutEffect(() => {
    const el = container?.current
    if (!el) return
    el.classList.add('timeline-scroll')
    const measure = () => {
      setMetrics({
        trackH: Math.max(0, el.clientHeight - RAIL_INSET * 2),
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        padTop: parseFloat(getComputedStyle(el).paddingTop) || 0,
      })
      // fixed → viewport coordinates; `right` from the document edge (clientWidth excludes any
      // page scrollbar, matching the old right-0 on every scrollbar mode)
      const rect = el.getBoundingClientRect()
      setBox({
        top: rect.top,
        height: rect.height,
        right: document.documentElement.clientWidth - rect.right,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      el.classList.remove('timeline-scroll')
    }
  }, [container, layout.totalHeight])

  // Popup grace: every real scroll step re-arms a 1s hide timer; identity-only scrollPos updates
  // (resize with an unchanged top, the mount measure) re-arm it too instead of killing it.
  useEffect(() => {
    const topChanged = lastTopRef.current !== scrollPos.top
    lastTopRef.current = scrollPos.top
    if (!topChanged && !scrolling) return
    setScrolling(true)
    const timer = window.setTimeout(() => setScrolling(false), GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [scrollPos, scrolling])

  const m = metrics
  const monthKey = m
    ? monthAtContentY(layout.buckets, scrollPos.top + m.clientH / 2 - m.padTop)
    : ''
  const { month, year } = useMemo(() => monthYearLabel(monthKey), [monthKey])

  if (!container || !m || !box || m.scrollH <= m.clientH || layout.buckets.length === 0) return null

  const maxScroll = m.scrollH - m.clientH
  const thumb = thumbGeometry(scrollPos.top, m)
  const popupVisible = dragging || hovered || scrolling
  const popupY = Math.min(
    Math.max(RAIL_INSET + thumb.top + thumb.height / 2, 14),
    Math.max(14, m.clientH - 14),
  )
  // Month ticks mark each bucket's top edge. The year line (January, blue) marks the year FLIP —
  // the Jan bucket's bottom edge, where Jan 1's photos meet the prior year's December.
  const ticks = layout.buckets.flatMap((bucket) => {
    // December's start tick coincides with the blue year line — the year tick covers it
    if (bucket.key.endsWith('-12')) return []
    const start = { key: bucket.key, y: RAIL_INSET + railYForContentY(bucket.top, m), year: false }
    return bucket.key.endsWith('-01')
      ? [
          start,
          {
            key: `${bucket.key}-year`,
            y: RAIL_INSET + railYForContentY(bucket.top + bucket.height, m),
            year: true,
          },
        ]
      : [start]
  })

  const railYFromClient = (clientY: number): number => {
    const rect = stripRef.current?.getBoundingClientRect()
    return rect ? clientY - rect.top - RAIL_INSET : 0
  }

  const applyRailY = (railY: number) => {
    const el = container?.current
    if (!el || !m) return
    // 'instant' so a scrub follows the pointer 1:1 — main's scroll-smooth must not lag the drag
    el.scrollTo({ top: scrollTopForRailY(railY, m), behavior: 'instant' })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // secondary buttons would orphan the drag — the context menu swallows their pointerup
    if (e.button !== 0 || e.buttons !== 1) return
    const railY = railYFromClient(e.clientY)
    const center = thumb.top + thumb.height / 2
    // pointerdown on the thumb keeps the grab offset; on the track it centers the viewport there
    const grab = railY >= thumb.top && railY <= thumb.top + thumb.height ? railY - center : 0
    dragRef.current = { grab }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (grab === 0) applyRailY(railY)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const grab = dragRef.current?.grab
    if (grab === undefined) return
    if (e.buttons === 0) {
      // orphaned drag: the pointerup was swallowed (context menu, capture lost off-window) —
      // self-heal on the next hover-move instead of scrubbing the scroll on hover
      dragRef.current = null
      setDragging(false)
      return
    }
    applyRailY(railYFromClient(e.clientY) - grab)
  }

  const onPointerDone = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setDragging(false)
    // with pointer capture, leave events are unreliable — resolve hover from the release point
    const rect = stripRef.current?.getBoundingClientRect()
    setHovered(
      !!rect &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom,
    )
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = container?.current
    if (!el || !m) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        el.scrollBy({ top: 120, behavior: 'instant' })
        break
      case 'ArrowUp':
        e.preventDefault()
        el.scrollBy({ top: -120, behavior: 'instant' })
        break
      case 'PageDown':
        e.preventDefault()
        el.scrollBy({ top: m.clientH, behavior: 'instant' })
        break
      case 'PageUp':
        e.preventDefault()
        el.scrollBy({ top: -m.clientH, behavior: 'instant' })
        break
      case 'Home':
        e.preventDefault()
        el.scrollTo({ top: 0, behavior: 'instant' })
        break
      case 'End':
        e.preventDefault()
        el.scrollTo({ top: m.scrollH, behavior: 'instant' })
        break
      default:
    }
  }

  return (
    <div
      ref={stripRef}
      role="scrollbar"
      aria-label="Timeline position"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((Math.min(scrollPos.top, maxScroll) / maxScroll) * 100)}
      tabIndex={0}
      className="group fixed z-40 w-4 cursor-ns-resize touch-none select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
      style={{ top: box.top, height: box.height, right: box.right }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerDone}
      onPointerCancel={onPointerDone}
      onLostPointerCapture={onPointerDone}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onKeyDown={onKeyDown}
    >
      {/* rail */}
      <div
        className="absolute left-1/2 w-1 -translate-x-1/2 rounded-full bg-white/10 transition-colors duration-150 group-hover:bg-white/25"
        style={{ top: RAIL_INSET, height: m.trackH }}
      />
      {/* month ticks at each bucket's real layout height; January ticks longer + primary */}
      {ticks.map((tick) => (
        <div
          key={tick.key}
          aria-hidden
          className={`absolute left-1/2 h-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
            tick.year ? 'w-4 bg-primary/80' : 'w-3 bg-white/40'
          }`}
          style={{ top: tick.y }}
        />
      ))}
      {/* thumb: grip lines appear on hover/press */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-[width,background-color] duration-150 ${
          dragging ? 'w-3 bg-primary' : 'w-2.5 bg-slate-500 group-hover:w-3 group-hover:bg-primary'
        }`}
        style={{ top: RAIL_INSET + thumb.top + thumb.height / 2, height: thumb.height }}
      >
        <span
          aria-hidden
          className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-[3px] transition-opacity duration-150 ${
            dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <span className="block h-px w-2 rounded-full bg-white/80" />
          <span className="block h-px w-2 rounded-full bg-white/80" />
        </span>
      </div>
      {/* YEAR + MONTH popup, tracking the thumb (viewport centre) while scrolling/scrubbing */}
      <div
        aria-hidden={!popupVisible}
        className={`pointer-events-none absolute right-full mr-2 flex h-7 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-border-dark bg-card-dark px-3 shadow-lg shadow-black/40 transition-[opacity,scale] duration-150 ease-out after:absolute after:right-0 after:top-1/2 after:h-2 after:w-2 after:translate-x-1/2 after:-translate-y-1/2 after:rotate-45 after:border-r after:border-t after:border-border-dark after:bg-card-dark ${
          popupVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        style={{ top: popupY }}
      >
        <span className="text-sm font-semibold text-white">{month}</span>
        <span className="text-sm font-bold tracking-wide text-primary">{year}</span>
      </div>
    </div>
  )
}
