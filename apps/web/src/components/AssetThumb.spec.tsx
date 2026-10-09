import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { Asset, AssetThumbnail } from '@photox/shared-types'

// pending: the cache-miss path must stay on the Skeleton, so the download never settles
const pendingThumb = new Promise<Blob>(() => {
  /* intentionally never resolves */
})
vi.mock('../api/assets', () => ({ downloadFile: vi.fn(() => pendingThumb) }))

import { AssetThumb } from './AssetThumb'
import { ScrollContainerContext } from './AppShell'
import { viewerThumbKey } from '../lib/asset-media'
import { clearBlobCache, getCachedBlobUrl } from '../lib/blob-cache'
import { resetSharedIntersection } from '../lib/shared-intersection'
import { TIMELINE_PREFETCH_PX } from '../lib/timelineLayout'

// jsdom has no IntersectionObserver; the stub records the callback and the init so a test can decide
// whether the tile was ever told it intersected, and which box it was tested against.
let intersect: (() => void) | null = null
let lastInit: IntersectionObserverInit | undefined
let constructed = 0
class IOStub {
  constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
    constructed++
    lastInit = init
    intersect = () =>
      cb([{ isIntersecting: true }] as unknown as IntersectionObserverEntry[], this as never)
  }
  observe(): void {
    /* no-op: visibility is driven by the captured callback only */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

let urlSeq = 0
const createObjectURL = vi.fn(() => `blob:mock-${++urlSeq}`)
const revokeObjectURL = vi.fn()

const thumb = { fileId: 'f1', size: 'md', width: 4, height: 3 } as AssetThumbnail
const asset = { id: 'a1', kind: 'photo', fileId: 'f1', thumbnails: [thumb] } as Asset

beforeEach(() => {
  intersect = null
  constructed = 0
  urlSeq = 0
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  clearBlobCache()
  createObjectURL.mockClear()
  // Drop observers cached against the previous test's stub before re-stubbing the global.
  resetSharedIntersection()
  vi.stubGlobal('IntersectionObserver', IOStub)
})

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
  vi.unstubAllGlobals()
})

describe('AssetThumb remount', () => {
  it('paints an already-cached thumb on first render, before the tile ever intersects', async () => {
    await getCachedBlobUrl(viewerThumbKey(thumb), () => Promise.resolve({ size: 8 } as Blob))

    const { container } = render(<AssetThumb asset={asset} />)

    // Scroll-back remounts this tile: the observer has not fired, yet the img is already there
    // instead of a Skeleton frame.
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/)
    expect(intersect).not.toBeNull()
  })

  it('falls back to a Skeleton when nothing is cached', () => {
    const { container } = render(<AssetThumb asset={asset} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
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
  it('downloads without ever registering an observer', async () => {
    const { downloadFile } = await import('../api/assets')
    render(<AssetThumb asset={asset} eager />)

    // A position:fixed thumb never intersects the timeline scroll root, so eager must skip the
    // observer entirely and go straight to the download.
    expect(intersect).toBeNull()
    expect(downloadFile).toHaveBeenCalledWith('f1')
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
