import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import type { Asset, AssetThumbnail } from '@photox/shared-types'

import { AssetThumb } from './AssetThumb'
import { ScrollContainerContext } from './AppShell'
import { resetSharedIntersection } from '../lib/shared-intersection'
import { TIMELINE_PREFETCH_PX } from '../lib/timelineLayout'

// jsdom has no IntersectionObserver; the stub records the callback and the init so a test can decide
// whether the tile was ever told it intersected, and which box it was tested against.
let intersect: (() => void) | null = null
let lastInit: IntersectionObserverInit | undefined
let constructed = 0
class IOStub {
  private targets: Element[] = []
  constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
    constructed++
    lastInit = init
    // The captured callback is the shared dispatcher (lib/shared-intersection), which routes by
    // entry.target — so the fake entry must carry the observed element.
    intersect = () =>
      cb(
        this.targets.map(
          (target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry,
        ),
        this as unknown as IntersectionObserver,
      )
  }
  observe(el: Element): void {
    this.targets.push(el)
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

const thumb = { fileId: 'f1', size: 'md', width: 4, height: 3 } as AssetThumbnail
const asset = { id: 'a1', kind: 'photo', fileId: 'f1', thumbnails: [thumb] } as Asset

beforeEach(() => {
  intersect = null
  constructed = 0
  // Drop observers cached against the previous test's stub before re-stubbing the global.
  resetSharedIntersection()
  vi.stubGlobal('IntersectionObserver', IOStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AssetThumb gating', () => {
  it('shows a Skeleton, then the direct stream URL once the tile intersects', () => {
    const { container } = render(<AssetThumb asset={asset} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).not.toContain('No preview')
    expect(container.querySelector('.animate-pulse')).not.toBeNull()

    act(() => intersect?.())

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/files/f1/stream')
  })

  it('shows the No preview fallback when the stream image fails to load', () => {
    const { container } = render(<AssetThumb asset={asset} eager />)

    fireEvent.error(container.querySelector('img')!)

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('No preview')
  })
})

describe('AssetThumb prefetch window', () => {
  it('tests against the timeline scroller, not the viewport', () => {
    // A viewport root makes rootMargin inert: <main> clips the intersection rect back to its
    // visible edge, so nothing off screen is ever observed.
    const scroller = document.createElement('div')
    render(
      <ScrollContainerContext.Provider value={{ current: scroller }}>
        <AssetThumb asset={asset} />
      </ScrollContainerContext.Provider>,
    )

    expect(lastInit?.root).toBe(scroller)
    // matches TimelineGrid's mount window — absolute lengths only, vh would throw SyntaxError
    expect(lastInit?.rootMargin).toBe(`${TIMELINE_PREFETCH_PX}px 0px`)
  })

  it('degrades to the viewport root outside AppShell', () => {
    render(<AssetThumb asset={asset} />)

    expect(lastInit?.root).toBeNull()
  })
})

describe('AssetThumb eager (fixed-overlay contexts)', () => {
  it('renders the direct stream URL without ever registering an observer', () => {
    const { container } = render(<AssetThumb asset={asset} eager />)

    // A position:fixed thumb never intersects the timeline scroll root, so eager must skip the
    // observer entirely and go straight to the stream URL.
    expect(intersect).toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/files/f1/stream')
  })
})

describe('AssetThumb observer sharing', () => {
  it('shares one IntersectionObserver across 100 tiles in the same scroll root', () => {
    const scroller = document.createElement('div')
    render(
      <ScrollContainerContext.Provider value={{ current: scroller }}>
        {Array.from({ length: 100 }, (_, i) => (
          <AssetThumb
            key={i}
            asset={
              {
                id: `a${i}`,
                kind: 'photo',
                fileId: `f${i}`,
                thumbnails: [{ fileId: `f${i}`, size: 'md', width: 4, height: 3 }],
              } as Asset
            }
          />
        ))}
      </ScrollContainerContext.Provider>,
    )

    expect(
      constructed,
      'one shared observer per scroll root, not one per tile',
    ).toBeLessThanOrEqual(2)
  })
})
