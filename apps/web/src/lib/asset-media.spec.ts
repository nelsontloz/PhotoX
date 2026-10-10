import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { prefetchViewerMedia } from './asset-media'

const lg = { fileId: 'v-lg', size: 'lg', width: 4, height: 3 } as AssetThumbnail
const md = { fileId: 'p-md', size: 'md', width: 4, height: 3 } as AssetThumbnail
const xl = { fileId: 'p-xl', size: 'xl', width: 4, height: 3 } as AssetThumbnail

const warmed: string[] = []
class ImageStub {
  set src(value: string) {
    warmed.push(value)
  }
}

beforeEach(() => {
  warmed.length = 0
  vi.stubGlobal('Image', ImageStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefetchViewerMedia', () => {
  it('warms the same stream URL the viewer will render', () => {
    prefetchViewerMedia({ id: 'p', kind: 'photo', thumbnails: [xl] } as Asset)
    prefetchViewerMedia({ id: 'v', kind: 'video', thumbnails: [lg, md] } as Asset)

    expect(warmed).toEqual(['/api/v1/files/p-xl/stream', '/api/v1/files/v-lg/stream'])
  })

  it('does nothing without a thumb to warm', () => {
    prefetchViewerMedia({ id: 'p', kind: 'photo', thumbnails: [] as AssetThumbnail[] } as Asset)

    expect(warmed).toEqual([])
  })
})
