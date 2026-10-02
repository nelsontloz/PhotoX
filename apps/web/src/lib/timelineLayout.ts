import { groupDateSortKey } from './dateFormat'

// Browser-verified fixed-row timeline constants.
const HEADER_BLOCK = 65 // 49px sticky header + 16px mb-4
const GAP = 4 // flex gap between rows
const SECTION_MARGIN = 40 // section mb-10

/** How far past the visible screen, in px, tiles are kept mounted AND armed.
 *
 *  Shared by TimelineGrid's mount window and AssetThumb's observer rootMargin — they must agree.
 *  A margin wider than the mount window is inert (the tile is never in the DOM to observe); a
 *  margin narrower than it mounts tiles that never download. This is the second time that pair
 *  drifted, hence one constant.
 *
 *  ponytail: costs ~2 extra screens of mounted days, each day mounting all its tiles with a live
 *  IntersectionObserver. Upgrade path = row-granular windowing if mounted DOM shows up in profiles.
 */
export const TIMELINE_PREFETCH_PX = 2000

export interface TimelineItem {
  t: string
  w: number | null
  h: number | null
}

export interface TimelineLayoutOptions {
  containerWidth: number
  rowHeight: number
}

export interface TimelineBucketDay {
  sortKey: string
  /** Offset of the day section from its bucket's top, px (SECTION_MARGIN gaps included) */
  top: number
  height: number
  /** The day's layout items (desc) — skeleton tiles pack from these before the month is fetched */
  items: TimelineItem[]
}

export interface TimelineBucket {
  key: string
  top: number
  height: number
  days: TimelineBucketDay[]
}

export interface TimelineDaySlot {
  bucketKey: string
  height: number
  rows: number
}

export interface TimelineLayout {
  buckets: TimelineBucket[]
  totalHeight: number
  dayIndex: Map<string, TimelineDaySlot>
}

type Dims = Pick<TimelineItem, 'w' | 'h'>

export function packRows(items: readonly Dims[], opts: TimelineLayoutOptions): number {
  if (items.length === 0) return 0
  // ponytail: unmeasured container reserves one row, not one row per item
  if (opts.containerWidth <= 0) return 1

  let rows = 1
  let rowWidth = 0
  let rowEmpty = true
  for (const item of items) {
    const width = opts.rowHeight * ((item.w ?? 1) / (item.h ?? 1))
    if (rowEmpty) {
      rowWidth = width
      rowEmpty = false
    } else if (rowWidth + GAP + width <= opts.containerWidth) {
      rowWidth += GAP + width
    } else {
      rows += 1
      rowWidth = width
    }
  }
  return rows
}

export function buildBuckets(
  items: readonly TimelineItem[],
  opts: TimelineLayoutOptions,
): TimelineLayout {
  const sorted = items
    .map((item) => ({ item, time: new Date(item.t).getTime() }))
    .sort((a, b) => b.time - a.time)
    .map(({ item }) => item)

  const byDay = new Map<string, TimelineItem[]>()
  for (const item of sorted) {
    const key = groupDateSortKey(item.t)
    const day = byDay.get(key)
    if (day) day.push(item)
    else byDay.set(key, [item])
  }

  const buckets: TimelineBucket[] = []
  const dayIndex = new Map<string, TimelineDaySlot>()

  for (const [sortKey, dayItems] of [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a))) {
    const rows = packRows(dayItems, opts)
    const height = HEADER_BLOCK + rows * (opts.rowHeight + GAP) - GAP
    const bucketKey = sortKey.slice(0, 7)

    dayIndex.set(sortKey, { bucketKey, height, rows })

    const last = buckets[buckets.length - 1]
    if (last?.key === bucketKey) {
      // before the +=: last.height === previousDay.top + previousDay.height
      const top = last.height + SECTION_MARGIN
      last.height += SECTION_MARGIN + height
      last.days.push({ sortKey, top, height, items: dayItems })
    } else {
      buckets.push({
        key: bucketKey,
        top: 0,
        height,
        days: [{ sortKey, top: 0, height, items: dayItems }],
      })
    }
  }

  let top = 0
  for (const bucket of buckets) {
    bucket.top = top
    top += bucket.height + SECTION_MARGIN
  }

  return {
    buckets,
    // margins sit only between sections, so totalHeight = lastBucket.top + lastBucket.height
    totalHeight: buckets.length > 0 ? top - SECTION_MARGIN : 0,
    dayIndex,
  }
}
