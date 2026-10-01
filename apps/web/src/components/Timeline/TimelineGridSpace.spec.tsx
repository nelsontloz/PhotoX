import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { RefObject } from 'react'
import type { AssetLayout } from '@photox/shared-types'
import { buildBuckets, type TimelineItem } from '../../lib/timelineLayout'
import { ScrollContainerContext } from '../AppShell'

// Pinned measurement inputs — jsdom has no ResizeObserver and resolves no stylesheet vars, so the
// stubs below must feed useTimelineLayout exactly these values.
const CONTAINER_WIDTH = 1000
const ROW_HEIGHT = 200

// Realistic layout-endpoint payload: two months, mixed aspects, one null-dims item (→ 1:1), and
// a day that wraps past one row. Local-noon times keep groupDateSortKey stable in every timezone.
const LAYOUT_ITEMS: TimelineItem[] = [
  // 2026-03-20 — four 4:3 tiles (266.7px) → three fit, the fourth wraps → 2 rows
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  { t: '2026-03-20T12:00:00', w: 4000, h: 3000 },
  // 2026-03-15 — 16:9 + null dims (200px) + 16:9 → 1 row
  { t: '2026-03-15T12:00:00', w: 1920, h: 1080 },
  { t: '2026-03-15T12:00:00', w: null, h: null },
  { t: '2026-03-15T12:00:00', w: 1920, h: 1080 },
  // 2026-02-10 — two 1:1 → 1 row
  { t: '2026-02-10T12:00:00', w: 1000, h: 1000 },
  { t: '2026-02-10T12:00:00', w: 1000, h: 1000 },
  // 2026-02-01 — five 16:9 (355.6px) → two per row, the fifth wraps → 3 rows
  ...Array.from({ length: 5 }, () => ({ t: '2026-02-01T12:00:00', w: 1920, h: 1080 })),
]

vi.mock('../../api/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/assets')>()
  return { ...actual, getAssetLayout: vi.fn() }
})

import { getAssetLayout } from '../../api/assets'
import { useTimelineLayout } from '../../hooks/useTimelineLayout'
import { TimelineGrid } from './TimelineGrid'

const getAssetLayoutMock = vi.mocked(getAssetLayout)

function stubMeasurement(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: CONTAINER_WIDTH,
    height: 800,
  } as DOMRect)

  const realGetComputedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    // the hook's hidden .fixed-row-gallery probe is the only reader of --row-height
    if (el.classList.contains('fixed-row-gallery') && el.parentElement === document.body) {
      return {
        getPropertyValue: (name: string) => (name === '--row-height' ? `${ROW_HEIGHT}px` : ''),
      } as CSSStyleDeclaration
    }
    return realGetComputedStyle(el)
  })
}

const noopEnsureMonth = (): Promise<null> => Promise.resolve(null)
const onSelectStub = vi.fn()
const onToggleSelectStub = vi.fn()

// Cheapest seam that keeps the real data flow: layout endpoint → useTimelineLayout → TimelineGrid.
function TimelineHarness() {
  const { layout, containerRef } = useTimelineLayout()
  return (
    <TimelineGrid
      layout={layout}
      containerRef={containerRef}
      groups={[]}
      monthStatus={new Map()}
      ensureMonth={noopEnsureMonth}
      refreshKey={0}
      onSelect={onSelectStub}
      selectedIds={new Set()}
      onToggleSelect={onToggleSelectStub}
    />
  )
}

describe('TimelineGrid reserved space', () => {
  beforeEach(() => {
    getAssetLayoutMock.mockReset()
    getAssetLayoutMock.mockResolvedValue({ items: LAYOUT_ITEMS } as AssetLayout)
    stubMeasurement()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reserves exactly the buildBuckets() space fed by GET /api/v1/assets/layout', async () => {
    const expected = buildBuckets(LAYOUT_ITEMS, {
      containerWidth: CONTAINER_WIDTH,
      rowHeight: ROW_HEIGHT,
    })
    // guard the fixture so the comparison can't pass vacuously
    expect(expected.buckets.map((b) => b.key)).toEqual(['2026-03', '2026-02'])
    expect(expected.buckets[0]?.days[0]?.sortKey).toBe('2026-03-20')
    expect(expected.dayIndex.get('2026-03-20')?.rows).toBe(2)

    const { container } = render(<TimelineHarness />)

    // container track: reserved height must equal totalHeight
    const track = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.max-w-6xl')
      expect(el).not.toBeNull()
      expect(el?.style.height).toBe(`${expected.totalHeight}px`)
      return el!
    })
    expect(getAssetLayoutMock).toHaveBeenCalledTimes(1)

    // month buckets: absolute top + height per bucket, then each day section's height
    const monthEls = Array.from(track.children) as HTMLElement[]
    expect(monthEls).toHaveLength(expected.buckets.length)

    expected.buckets.forEach((bucket, i) => {
      const monthEl = monthEls[i]
      expect(monthEl?.style.top).toBe(`${bucket.top}px`)
      expect(monthEl?.style.height).toBe(`${bucket.height}px`)

      const dayEls = Array.from(monthEl?.children ?? []) as HTMLElement[]
      expect(dayEls).toHaveLength(bucket.days.length)
      bucket.days.forEach((day, j) => {
        expect(dayEls[j]?.style.height).toBe(`${day.height}px`)
      })
    })
  })

  it('mounts only the days intersecting the scroll window, keeping reserved heights', async () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollTop', { value: 0 })
    Object.defineProperty(el, 'clientHeight', { value: 100 })
    const scrollRef: RefObject<HTMLDivElement> = { current: el }

    const { container } = render(
      <ScrollContainerContext.Provider value={scrollRef}>
        <TimelineHarness />
      </ScrollContainerContext.Provider>,
    )

    // window = [0 − 100, 0 + 2×100] = [−100, 200]: bucket 2026-03 (top 0, height 774) is the only
    // mounted bucket; its 2026-03-20 day (top 0, height 469) is in-window, 2026-03-15 (top 509) is
    // not. The unmounted 2026-02 bucket and the off-window day keep their reserved space.
    await waitFor(() => {
      expect(container.querySelectorAll('.max-w-6xl > section')).toHaveLength(1)
    })
    expect(getAssetLayoutMock).toHaveBeenCalledTimes(1)

    const monthEl = container.querySelector<HTMLElement>('.max-w-6xl > section')
    const dayEls = Array.from(monthEl?.querySelectorAll<HTMLElement>(':scope > section') ?? [])
    expect(dayEls).toHaveLength(2)
    expect(dayEls[0]?.querySelector('.fixed-row-gallery')).not.toBeNull()
    expect(dayEls[1]?.querySelector('.fixed-row-gallery')).toBeNull()
    expect(dayEls[1]?.style.height).toBe('265px')
  })
})
