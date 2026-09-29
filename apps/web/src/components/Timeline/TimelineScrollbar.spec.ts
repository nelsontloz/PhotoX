import { describe, it, expect } from 'vitest'
import { buildBuckets, type TimelineItem } from '../../lib/timelineLayout'
import { monthYearLabel } from '../../lib/dateFormat'
import {
  monthAtContentY,
  railYForContentY,
  scrollTopForRailY,
  thumbGeometry,
  type ScrollbarMetrics,
} from './TimelineScrollbar'

// Three months with different bucket heights (real buildBuckets output — the indicator's ticks
// must follow these, not an even month split). Local-noon times keep keys timezone-stable.
const LAYOUT_ITEMS: TimelineItem[] = [
  ...Array.from({ length: 4 }, () => ({ t: '2024-03-15T12:00:00', w: 4000, h: 3000 })),
  ...Array.from({ length: 2 }, () => ({ t: '2024-02-10T12:00:00', w: 1000, h: 1000 })),
  ...Array.from({ length: 4 }, () => ({ t: '2024-01-05T12:00:00', w: 1920, h: 1080 })),
]
const layout = buildBuckets(LAYOUT_ITEMS, { containerWidth: 1000, rowHeight: 200 })

// <main> as the strip sees it: 400px viewport, 24px top/bottom padding → 368px rail,
// scrollHeight = timeline content + padding.
const metrics: ScrollbarMetrics = {
  trackH: 400 - 32,
  scrollH: layout.totalHeight + 48,
  clientH: 400,
  padTop: 24,
}

describe('timeline scrollbar geometry', () => {
  it('lines each bucket tick up with the thumb top edge', () => {
    // guard the fixture so the comparisons below can't pass vacuously
    expect(layout.buckets.map((b) => b.key)).toEqual(['2024-03', '2024-02', '2024-01'])
    expect(metrics.scrollH).toBeGreaterThan(metrics.clientH)

    for (const bucket of layout.buckets) {
      const tick = railYForContentY(bucket.top, metrics)
      const thumb = thumbGeometry(metrics.padTop + bucket.top, metrics)
      expect(tick).toBeCloseTo(thumb.top)
      expect(thumb.top + thumb.height).toBeLessThanOrEqual(metrics.trackH)
    }
  })

  it('center-maps rail positions back to scrollTop (popup month = month under the thumb)', () => {
    const contentY = 700
    const scrollTop = scrollTopForRailY(railYForContentY(contentY, metrics), metrics)
    expect(scrollTop).toBeCloseTo(contentY + metrics.padTop - metrics.clientH / 2)
  })

  it('clamps scrub targets to the scroll range', () => {
    const maxScroll = metrics.scrollH - metrics.clientH
    expect(scrollTopForRailY(-500, metrics)).toBe(0)
    expect(scrollTopForRailY(10_000, metrics)).toBe(maxScroll)
  })

  it('keeps a usable thumb on very long timelines without leaving the rail', () => {
    const long: ScrollbarMetrics = { ...metrics, scrollH: 200_000 }
    const atEnd = thumbGeometry(long.scrollH - long.clientH, long)
    expect(atEnd.height).toBe(32)
    expect(atEnd.top + atEnd.height).toBeLessThanOrEqual(long.trackH)
  })

  it('reads the month bucket covering a content offset', () => {
    const buckets = layout.buckets
    const second = buckets[1]
    expect(monthAtContentY(buckets, -10)).toBe('2024-03')
    expect(second).toBeDefined()
    if (!second) return
    // inside the second bucket, in the 40px gap after it, and past the end
    expect(monthAtContentY(buckets, second.top + 10)).toBe('2024-02')
    expect(monthAtContentY(buckets, second.top + second.height + 10)).toBe('2024-02')
    expect(monthAtContentY(buckets, Number.MAX_SAFE_INTEGER)).toBe('2024-01')
    expect(monthAtContentY([], 100)).toBe('')
  })

  it('splits the popup label into month + year', () => {
    expect(monthYearLabel('2024-03')).toEqual({ month: 'March', year: '2024' })
    expect(monthYearLabel('nope')).toEqual({ month: 'nope', year: '' })
  })
})
