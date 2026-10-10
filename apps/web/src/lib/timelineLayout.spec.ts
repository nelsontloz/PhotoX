import { describe, it, expect } from 'vitest'
import { buildBuckets, packRows } from './timelineLayout'
import type { TimelineItem, TimelineLayoutOptions } from './timelineLayout'

const OPTS: TimelineLayoutOptions = { containerWidth: 1152, rowHeight: 200 }

function item(t: string, w: number | null, h: number | null): TimelineItem {
  return { t, w, h }
}

function dayItems(
  day: string,
  count: number,
  w: number | null = 4000,
  h: number | null = 3000,
): TimelineItem[] {
  return Array.from({ length: count }, () => item(`${day}T12:00:00`, w, h))
}

function mixedDay(day: string, count: number): TimelineItem[] {
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0 ? item(`${day}T12:00:00`, 4000, 3000) : item(`${day}T12:00:00`, 1920, 1080),
  )
}

describe('packRows', () => {
  it('packs 4:3 tiles four per row at 1152px / 200px', () => {
    expect(packRows(dayItems('2026-03-20', 4), OPTS)).toBe(1)
    expect(packRows(dayItems('2026-03-20', 5), OPTS)).toBe(2)
    expect(packRows(dayItems('2026-03-20', 8), OPTS)).toBe(2)
    expect(packRows(dayItems('2026-03-20', 9), OPTS)).toBe(3)
  })

  it('packs 16:9 tiles three per row at 1152px / 200px', () => {
    expect(packRows(dayItems('2026-03-20', 3, 1920, 1080), OPTS)).toBe(1)
    expect(packRows(dayItems('2026-03-20', 4, 1920, 1080), OPTS)).toBe(2)
    expect(packRows(dayItems('2026-03-20', 6, 1920, 1080), OPTS)).toBe(2)
    expect(packRows(dayItems('2026-03-20', 7, 1920, 1080), OPTS)).toBe(3)
  })

  it('greedy-packs mixed aspects in item order', () => {
    // 4:3,16:9,4:3 = 896.9px | 16:9,4:3,16:9 = 1256.4px → wrap | 4:3,16:9
    expect(packRows(mixedDay('2026-03-20', 8), OPTS)).toBe(3)
  })

  it('coalesces null dimensions to 1:1', () => {
    // six 200px-wide tiles: five + gaps = 1016px, the sixth wraps
    expect(packRows(dayItems('2026-03-20', 6, null, null), OPTS)).toBe(2)
  })

  it('uses <= for the fit test (exact-width rows stay on one row)', () => {
    const square = dayItems('2026-03-20', 3, 1, 1)
    expect(packRows(square, { containerWidth: 308, rowHeight: 100 })).toBe(1) // 100*3 + 4*2 = 308
    expect(packRows(square, { containerWidth: 307, rowHeight: 100 })).toBe(2)
  })

  it('returns 0 rows for no items and 1 row for a non-measurable container', () => {
    expect(packRows([], OPTS)).toBe(0)
    expect(packRows(dayItems('2026-03-20', 4), { containerWidth: 0, rowHeight: 200 })).toBe(1)
    expect(packRows(dayItems('2026-03-20', 4), { containerWidth: -1, rowHeight: 200 })).toBe(1)
  })
})

describe('buildBuckets', () => {
  it('computes exact day section heights and rows for known aspects', () => {
    const layout = buildBuckets(
      [
        ...dayItems('2026-03-20', 4), // 4:3 ×4 → 1 row
        ...dayItems('2026-03-15', 5), // 4:3 ×5 → 2 rows
        ...mixedDay('2026-03-10', 8), // alternating → 3 rows
        ...dayItems('2026-03-05', 6, null, null), // null dims → 1:1, ×6 → 2 rows
      ],
      OPTS,
    )

    expect(layout.buckets).toHaveLength(1)
    const bucket = layout.buckets[0]
    expect(bucket?.key).toBe('2026-03')
    expect(bucket?.top).toBe(0)
    expect(bucket?.days.map(({ sortKey, height }) => ({ sortKey, height }))).toEqual([
      { sortKey: '2026-03-20', height: 265 }, // 65 + 1 × 204 − 4
      { sortKey: '2026-03-15', height: 469 }, // 65 + 2 × 204 − 4
      { sortKey: '2026-03-10', height: 673 }, // 65 + 3 × 204 − 4
      { sortKey: '2026-03-05', height: 469 },
    ])
    // day offsets inside the bucket: first at 0, then prev.top + prev.height + 40
    expect(bucket?.days.map((d) => d.top)).toEqual([0, 305, 814, 1527])
    const lastDay = bucket?.days[bucket.days.length - 1]
    expect((lastDay?.top ?? 0) + (lastDay?.height ?? 0)).toBe(bucket?.height)
    // per-day items ride along so skeleton tiles can pack into the reserved rows
    expect(bucket?.days[0]?.items).toHaveLength(4)
    expect(bucket?.days[0]?.items[0]).toEqual({ t: '2026-03-20T12:00:00', w: 4000, h: 3000 })
    expect(bucket?.height).toBe(265 + 40 + 469 + 40 + 673 + 40 + 469)
    expect(layout.totalHeight).toBe(1996)
    // int rowHeight → int heights/tops
    expect(Number.isInteger(bucket?.top)).toBe(true)
    expect(Number.isInteger(bucket?.height)).toBe(true)
    expect(Number.isInteger(layout.totalHeight)).toBe(true)
  })

  it('stacks month buckets with cumulative tops and totalHeight === lastTop + lastHeight', () => {
    const opts: TimelineLayoutOptions = { containerWidth: 500, rowHeight: 100 }
    // 1:1 tiles → 100px wide, 4 per row at 500px
    const { buckets, totalHeight } = buildBuckets(
      [
        ...dayItems('2026-03-20', 4, 1000, 1000), // 1 row → 165
        ...dayItems('2026-03-15', 5, 1000, 1000), // 2 rows → 269
        ...dayItems('2026-02-28', 1, 1000, 1000), // 1 row → 165
        ...dayItems('2026-02-10', 9, 1000, 1000), // 3 rows → 373
      ],
      opts,
    )

    expect(buckets.map((b) => b.key)).toEqual(['2026-03', '2026-02'])
    expect(buckets[0]?.top).toBe(0)
    expect(buckets[0]?.height).toBe(165 + 40 + 269) // 474
    expect(buckets[1]?.top).toBe(474 + 40) // 514
    expect(buckets[1]?.height).toBe(165 + 40 + 373) // 578
    expect(totalHeight).toBe(474 + 40 + 578) // 1092

    // per-bucket day offsets; last day top + height === bucket height
    expect(buckets[0]?.days.map((d) => d.top)).toEqual([0, 205])
    expect(buckets[1]?.days.map((d) => d.top)).toEqual([0, 205])
    for (const bucket of buckets) {
      const lastDay = bucket.days[bucket.days.length - 1]
      expect((lastDay?.top ?? 0) + (lastDay?.height ?? 0)).toBe(bucket.height)
    }

    const last = buckets[buckets.length - 1]
    expect(totalHeight).toBe((last?.top ?? 0) + (last?.height ?? 0))
  })

  it('sorts days descending by t and groups by local calendar day', () => {
    const items = [
      item('2026-02-10T23:30:00', 1000, 1000),
      item('2026-03-20T00:30:00', 1000, 1000),
      item('2026-03-20T23:30:00', 1000, 1000),
      item('2026-02-28T12:00:00', 1000, 1000),
    ]

    const { buckets } = buildBuckets(items, OPTS)

    expect(buckets.map((b) => b.key)).toEqual(['2026-03', '2026-02'])
    expect(buckets[0]?.days.map((d) => d.sortKey)).toEqual(['2026-03-20'])
    expect(buckets[1]?.days.map((d) => d.sortKey)).toEqual(['2026-02-28', '2026-02-10'])
    // both 2026-03-20 timestamps land in the same single day slot (asserted above by the day list)
    // input array is not mutated
    expect(items.map((i) => i.t)).toEqual([
      '2026-02-10T23:30:00',
      '2026-03-20T00:30:00',
      '2026-03-20T23:30:00',
      '2026-02-28T12:00:00',
    ])
  })

  it('returns no buckets and zero height for empty input', () => {
    expect(buildBuckets([], OPTS)).toEqual({ buckets: [], totalHeight: 0 })
  })
})
