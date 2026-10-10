import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { RefObject } from 'react'
import { buildBuckets } from '../../lib/timelineLayout'
import { ScrollContainerContext } from '../AppShell'
import { TimelineScrollbar } from './TimelineScrollbar'

// One 4:3 item — enough for a non-empty bucket list (the strip renders nothing without buckets).
const layout = buildBuckets([{ t: '2024-03-15T12:00:00', w: 4000, h: 3000 }], {
  containerWidth: 1000,
  rowHeight: 200,
})

/**
 * A dialog-like scroller: 5000px of content in a 300px box that starts 200px below the viewport
 * top and ends 124px short of its right edge in a 1024px viewport (panel centering + padding).
 * jsdom does no layout, so every measured value must be fed explicitly.
 */
function fakeScroller(): RefObject<HTMLDivElement> {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { value: 300 })
  Object.defineProperty(el, 'scrollHeight', { value: 5000 })
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 200,
    height: 300,
    right: 900,
  } as DOMRect)
  return { current: el }
}

describe('TimelineScrollbar box anchoring', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('positions the strip from the scroll container rect, not the viewport', () => {
    // jsdom has neither ResizeObserver nor the initial observe() it would deliver — the
    // component must still measure once on mount.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      },
    )
    // the old AppShell-only geometry (header 64px, viewport right edge) would be 64/960/0 —
    // all three inline values below must instead derive from the rect, so a `top-16 bottom-0
    // right-0` revert fails here (empty inline style)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024)

    const scrollRef = fakeScroller()
    const { container } = render(
      <ScrollContainerContext.Provider value={scrollRef}>
        <TimelineScrollbar layout={layout} scrollPos={{ top: 0, height: 300 }} />
      </ScrollContainerContext.Provider>,
    )

    const strip = container.querySelector<HTMLElement>('[role="scrollbar"]')
    expect(strip).not.toBeNull()
    expect(strip?.style.top).toBe('200px')
    expect(strip?.style.height).toBe('300px')
    expect(strip?.style.right).toBe('124px')
    // the native bar stays hidden while the strip is mounted — the point of the whole thing
    expect(scrollRef.current?.classList.contains('timeline-scroll')).toBe(true)
  })
})
