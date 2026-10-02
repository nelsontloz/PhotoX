import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import '../../src/app.css'
import type { Asset } from '@photox/shared-types'
import { buildBuckets, type TimelineItem } from '../../src/lib/timelineLayout'
import { TimelineGrid } from '../../src/components/Timeline/TimelineGrid'
import { useTimelineLayout } from '../../src/hooks/useTimelineLayout'
import { groupAssetsByDay } from '../../src/hooks/useAssetGroups'
import { effectiveAssetDate } from '../../src/lib/dateFormat'
import type { MonthStatus } from '../../src/hooks/useTimelineMonths'

// Same fixture as timeline-packing.spec.tsx (kept untouched): mixed aspects, a null-dims tile,
// multi-row days, two month buckets, and one panorama that must shrink to its row.
// ponytail: duplicated rather than extracted — the existing spec must stay byte-identical, so a
// shared fixture module would have exactly one consumer anyway.
const FIXTURE: TimelineItem[] = [
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  { t: '2026-03-20T11:00:00', w: 1920, h: 1080 },
  { t: '2026-03-20T10:00:00', w: 1, h: 1 },
  { t: '2026-03-20T09:00:00', w: null, h: null },
  { t: '2026-03-20T08:00:00', w: 3000, h: 2000 },
  { t: '2026-03-15T12:00:00', w: 1000, h: 1000 },
  { t: '2026-03-15T11:00:00', w: 1000, h: 1000 },
  { t: '2026-03-15T10:00:00', w: 1000, h: 1000 },
  { t: '2026-03-15T09:00:00', w: 1000, h: 1000 },
  { t: '2026-02-27T12:00:00', w: 1920, h: 1080 },
  { t: '2026-02-10T12:00:00', w: 8000, h: 1000 },
]

// The layout endpoint is the hook's only network call. Fixture assets carry no `thumbnails`, so
// AssetThumb never calls onThumbPicked and loaded GalleryItems keep --width/--height from the
// asset dims — identical to the skeleton inputs (thumb geometry is not what this spec tests).
vi.mock('../../src/api/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/assets')>()
  return {
    ...actual,
    getAssetLayout: async () => ({ items: FIXTURE }),
  }
})

const ASSETS = FIXTURE.map(
  (item, i) =>
    ({
      id: `asset-${i}`,
      kind: 'photo',
      takenAt: item.t,
      uploadedAt: item.t,
      width: item.w,
      height: item.h,
    }) as Asset,
)
const GROUPS = groupAssetsByDay(ASSETS, effectiveAssetDate)
const READY: ReadonlyMap<string, MonthStatus> = new Map([
  ['2026-03', 'ready'],
  ['2026-02', 'ready'],
])
const EMPTY_STATUS: ReadonlyMap<string, MonthStatus> = new Map()
// ponytail: static no-op — outside AppShell's ScrollContainerContext the fetch effect fires per
// render, but it never sets state so a stable identity buys nothing here
const ensureNothing = async () => null

/** Flips `loaded` via rerender so both states share one hook instance (same layout, no refetch). */
function Harness({ loaded }: { loaded: boolean }) {
  const { layout, containerRef, loading } = useTimelineLayout()
  if (loading) return <p>loading</p>
  return (
    <TimelineGrid
      layout={layout}
      containerRef={containerRef}
      groups={loaded ? GROUPS : []}
      monthStatus={loaded ? READY : EMPTY_STATUS}
      ensureMonth={ensureNothing}
      retainMonths={() => {}}
      refreshKey={0}
      onSelect={() => {}}
      selectedIds={new Set()}
      onToggleSelect={() => {}}
      showCheckbox={false}
    />
  )
}

const box = (el: Element) => el.getBoundingClientRect()

function must<T>(value: T | null | undefined, msg: string): T {
  if (value === null || value === undefined) throw new Error(msg)
  return value
}

const gridOf = (container: HTMLElement) =>
  must(container.querySelector<HTMLElement>('div.max-w-6xl'), 'grid container not found')

/** Waits until rowHeight is the CSS-resolved value and the grid height equals buildBuckets(). */
async function waitForPacked(container: HTMLElement, rowHeight: number) {
  await waitFor(() => {
    const grid = container.querySelector<HTMLElement>('div.max-w-6xl')
    if (!grid) throw new Error('grid container not found')
    const probe = grid.querySelector<HTMLElement>('.fixed-row-gallery')
    if (!probe) throw new Error('gallery not found')
    const computed = parseFloat(getComputedStyle(probe).getPropertyValue('--row-height'))
    if (computed !== rowHeight) throw new Error(`--row-height ${computed} != ${rowHeight}`)
    const predicted = buildBuckets(FIXTURE, { containerWidth: box(grid).width, rowHeight })
    if (Math.abs(box(grid).height - predicted.totalHeight) > 0.5) {
      throw new Error(`grid height ${box(grid).height} != predicted ${predicted.totalHeight}`)
    }
  })
}

interface DayGeometry {
  height: number
  galleryHeight: number
  scrollHeight: number
  tiles: number
  rowTops: number[]
}

interface Snapshot {
  gridHeight: number
  gridScrollHeight: number
  gridClientHeight: number
  buckets: { height: number; days: DayGeometry[] }[]
}

function snapshot(container: HTMLElement): Snapshot {
  const grid = gridOf(container)
  return {
    gridHeight: box(grid).height,
    gridScrollHeight: grid.scrollHeight,
    gridClientHeight: grid.clientHeight,
    buckets: [...grid.querySelectorAll<HTMLElement>(':scope > section')].map((bucket) => ({
      height: box(bucket).height,
      days: [...bucket.querySelectorAll<HTMLElement>(':scope > section')].map((day) => {
        const gallery = must(
          day.querySelector<HTMLElement>('.fixed-row-gallery'),
          'day gallery not found',
        )
        const galleryTop = box(gallery).top
        const tiles = [...gallery.querySelectorAll<HTMLElement>(':scope > figure')]
        return {
          height: box(day).height,
          galleryHeight: box(gallery).height,
          scrollHeight: day.scrollHeight,
          tiles: tiles.length,
          rowTops: [...new Set(tiles.map((t) => Math.round(box(t).top - galleryTop)))].sort(
            (a, b) => a - b,
          ),
        }
      }),
    })),
  }
}

function expectNoJump(before: Snapshot, after: Snapshot, label: string) {
  expect(before.buckets.length, `${label} bucket count`).toBe(after.buckets.length)
  expect(
    Math.abs(before.gridHeight - after.gridHeight),
    `${label} grid height`,
  ).toBeLessThanOrEqual(0.5)
  expect(
    Math.abs(before.gridScrollHeight - after.gridScrollHeight),
    `${label} grid scrollHeight`,
  ).toBeLessThanOrEqual(0.5)
  expect(
    Math.abs(before.gridClientHeight - after.gridClientHeight),
    `${label} grid clientHeight`,
  ).toBeLessThanOrEqual(0.5)

  before.buckets.forEach((bucket, bi) => {
    const other = after.buckets[bi]!
    expect(
      Math.abs(bucket.height - other.height),
      `${label} bucket ${bi} height`,
    ).toBeLessThanOrEqual(0.5)
    expect(bucket.days.length, `${label} bucket ${bi} day count`).toBe(other.days.length)
    bucket.days.forEach((day, di) => {
      const next = other.days[di]!
      expect(
        Math.abs(day.height - next.height),
        `${label} day ${bi}/${di} height`,
      ).toBeLessThanOrEqual(0.5)
      expect(
        Math.abs(day.galleryHeight - next.galleryHeight),
        `${label} day ${bi}/${di} gallery height`,
      ).toBeLessThanOrEqual(0.5)
      expect(
        Math.abs(day.scrollHeight - next.scrollHeight),
        `${label} day ${bi}/${di} scrollHeight`,
      ).toBeLessThanOrEqual(0.5)
      expect(day.tiles, `${label} day ${bi}/${di} tile count`).toBe(next.tiles)
      expect(day.rowTops.length, `${label} day ${bi}/${di} row count`).toBe(next.rowTops.length)
      day.rowTops.forEach((top, ri) => {
        expect(
          Math.abs(top - next.rowTops[ri]!),
          `${label} day ${bi}/${di} row ${ri} top`,
        ).toBeLessThanOrEqual(0.5)
      })
    })
  })
}

// Mirrors timeline-packing.spec.tsx's invariant set, parameterized by the viewport's rowHeight and
// recomputed against the measured column width (same tolerances, same notes).
function assertPacking(container: HTMLElement, rowHeight: number) {
  const grid = gridOf(container)
  const gallery = must(
    container.querySelector<HTMLElement>('.fixed-row-gallery'),
    'gallery not found',
  )
  const gap = parseFloat(getComputedStyle(gallery).getPropertyValue('--space'))
  expect(gap).toBe(4)
  expect(parseFloat(getComputedStyle(gallery).getPropertyValue('--row-height'))).toBe(rowHeight)

  const predicted = buildBuckets(FIXTURE, { containerWidth: box(grid).width, rowHeight })

  const bucketEls = [...grid.querySelectorAll<HTMLElement>(':scope > section')]
  expect(bucketEls.length).toBe(predicted.buckets.length)

  const dayPairs = predicted.buckets.flatMap((bucket, bi) =>
    [...(bucketEls[bi]?.querySelectorAll<HTMLElement>(':scope > section') ?? [])].map((el, di) => ({
      el,
      day: bucket.days[di]!,
      bucket,
    })),
  )
  expect(dayPairs.length).toBe(predicted.buckets.flatMap((b) => b.days).length)

  for (const { el, day } of dayPairs) {
    const dayGallery = el.querySelector<HTMLElement>('.fixed-row-gallery')!
    const tiles = [...dayGallery.querySelectorAll<HTMLElement>(':scope > figure')]
    expect(tiles.length, `${day.sortKey} tile count`).toBe(day.items.length)

    for (const tile of tiles) {
      expect(
        Math.abs(box(tile).height - rowHeight),
        `${day.sortKey} tile height`,
      ).toBeLessThanOrEqual(1)
    }

    const galleryTop = box(dayGallery).top
    const rowTops = [...new Set(tiles.map((t) => Math.round(box(t).top - galleryTop)))].sort(
      (a, b) => a - b,
    )
    expect(rowTops.length, `${day.sortKey} row count`).toBe(
      predicted.dayIndex.get(day.sortKey)!.rows,
    )
    rowTops.forEach((top, i) => {
      expect(
        Math.abs(top - i * (rowHeight + gap)),
        `${day.sortKey} row ${i} pitch`,
      ).toBeLessThanOrEqual(1)
    })

    const lastTop = rowTops[rowTops.length - 1]
    for (const top of rowTops) {
      const row = tiles.filter((t) => Math.round(box(t).top - galleryTop) === top)
      const used = row.reduce((sum, t) => sum + box(t).width, 0) + (row.length - 1) * gap
      if (top === lastTop) {
        expect(used, `${day.sortKey} last row width`).toBeLessThanOrEqual(box(dayGallery).width + 1)
      } else {
        expect(
          Math.abs(used - box(dayGallery).width),
          `${day.sortKey} row width`,
        ).toBeLessThanOrEqual(1)
      }
    }

    const contentBottom = Math.max(...tiles.map((t) => box(t).bottom)) - box(el).top
    expect(
      Math.abs(contentBottom - day.height),
      `${day.sortKey} content bottom`,
    ).toBeLessThanOrEqual(1.5)
    // panorama filler note carried over from timeline-packing.spec.tsx: the ::after filler can
    // wrap onto its own flex line and leak one gap below the tiles
    expect(el.scrollHeight, `${day.sortKey} overflow`).toBeLessThanOrEqual(day.height + gap + 1)
  }

  for (const bucket of predicted.buckets) {
    const own = dayPairs.filter((p) => p.bucket === bucket)
    for (let i = 1; i < own.length; i++) {
      const pitch = box(own[i]!.el).top - box(own[i - 1]!.el).top
      expect(
        Math.abs(pitch - (own[i - 1]!.day.height + 40)),
        `${bucket.key} day ${i} gap`,
      ).toBeLessThanOrEqual(1)
    }
  }

  const contentBottom = Math.max(...dayPairs.map((p) => box(p.el).bottom)) - box(grid).top
  expect(Math.abs(contentBottom - predicted.totalHeight)).toBeLessThanOrEqual(1.5)
  expect(grid.scrollHeight).toBeLessThanOrEqual(predicted.totalHeight + gap + 1)
}

// app.css: --row-height 200px, 140px under `width < 40rem` (640px). max-w-6xl = 72rem = 1152px.
const VIEWPORTS = [
  { name: 'mobile 375x667', width: 375, height: 667, rowHeight: 140 },
  { name: 'tablet 768x1024', width: 768, height: 1024, rowHeight: 200 },
  { name: 'desktop 1024x768', width: 1024, height: 768, rowHeight: 200 },
  { name: 'large desktop 1536x900', width: 1536, height: 900, rowHeight: 200 },
]
const MAX_W_6XL = 1152

// No global `afterEach` in this lane (its config drops the base test block), so RTL auto-cleanup
// never registers — unmount explicitly.
afterEach(cleanup)
// The browser lane reuses one page across files; leave the configured 1024x768 in place.
afterAll(async () => {
  await page.viewport(1024, 768)
})

describe.each(VIEWPORTS)('timeline responsive ($name)', ({ width, height, rowHeight }) => {
  it(`packs to buildBuckets and swaps skeleton→content with no space jump`, async () => {
    await page.viewport(width, height)
    const { container, rerender } = render(<Harness loaded={false} />)
    await waitForPacked(container, rowHeight)

    const skeleton = snapshot(container)
    expect(container.querySelectorAll('figure[role="button"]').length).toBe(0)

    rerender(<Harness loaded />)
    await waitFor(() => {
      const n = container.querySelectorAll('figure[role="button"]').length
      if (n !== FIXTURE.length) throw new Error(`expected ${FIXTURE.length} loaded tiles, got ${n}`)
    })
    const content = snapshot(container)

    expectNoJump(skeleton, content, `${width}x${height}`)
    assertPacking(container, rowHeight)
  })
})

describe('responsive column width', () => {
  it(`grows with the viewport and caps at max-w-6xl (${MAX_W_6XL}px)`, async () => {
    const widths: number[] = []
    for (const vp of VIEWPORTS) {
      await page.viewport(vp.width, vp.height)
      const { container, unmount } = render(<Harness loaded={false} />)
      await waitFor(() => {
        if (!container.querySelector('div.max-w-6xl')) throw new Error('grid container not found')
      })
      widths.push(box(gridOf(container)).width)
      unmount()
    }

    expect(widths[0]!).toBeLessThan(widths[1]!)
    expect(widths[1]!).toBeLessThan(widths[2]!)
    expect(widths[2]!).toBeLessThan(widths[3]!)
    expect(Math.abs(widths[3]! - MAX_W_6XL)).toBeLessThanOrEqual(0.5)
  })
})
