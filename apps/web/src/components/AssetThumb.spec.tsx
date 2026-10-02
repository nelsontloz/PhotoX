import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { Asset, AssetThumbnail } from '@photox/shared-types'

// pending: the cache-miss path must stay on the Skeleton, so the download never settles
const pendingThumb = new Promise<Blob>(() => {
  /* intentionally never resolves */
})
vi.mock('../api/assets', () => ({ downloadFile: vi.fn(() => pendingThumb) }))

import { AssetThumb } from './AssetThumb'
import { viewerThumbKey } from '../lib/asset-media'
import { clearBlobCache, getCachedBlobUrl } from '../lib/blob-cache'

// jsdom has no IntersectionObserver; the stub records the callback so a test can decide whether the
// tile was ever told it intersected. AssetThumb must paint a cached thumb without that signal.
let intersect: (() => void) | null = null
class IOStub {
  constructor(cb: IntersectionObserverCallback) {
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
  urlSeq = 0
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  clearBlobCache()
  createObjectURL.mockClear()
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
