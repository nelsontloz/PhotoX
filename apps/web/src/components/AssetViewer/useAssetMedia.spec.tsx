import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { Asset, AssetThumbnail } from '@photox/shared-types'

vi.mock('../../api/assets', () => ({ downloadFile: vi.fn() }))

import { downloadFile } from '../../api/assets'
import { viewerThumbKey } from '../../lib/asset-media'
import { clearBlobCache, getCachedBlobUrl } from '../../lib/blob-cache'
import { useAssetMedia } from './useAssetMedia'

const aXl = { fileId: 'a-xl', size: 'xl', width: 4, height: 3 } as AssetThumbnail
const bMd = { fileId: 'b-md', size: 'md', width: 4, height: 3 } as AssetThumbnail
const bXl = { fileId: 'b-xl', size: 'xl', width: 4, height: 3 } as AssetThumbnail

const assetA = { id: 'a', kind: 'photo', fileId: 'a-xl', thumbnails: [aXl] } as Asset
const assetB = { id: 'b', kind: 'photo', fileId: 'b-xl', thumbnails: [bMd, bXl] } as Asset

const never = () => new Promise<Blob>(() => undefined)

function Probe({ asset }: { asset: Asset }) {
  const { imageUrl, placeholderUrl, loading } = useAssetMedia(asset)
  return (
    <div>
      <span data-testid="image">{imageUrl ?? 'none'}</span>
      <span data-testid="placeholder">{placeholderUrl ?? 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  )
}

let urlSeq = 0
const createObjectURL = vi.fn(() => `blob:mock-${++urlSeq}`)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  urlSeq = 0
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  createObjectURL.mockClear()
  // stub first: clearing evicts entries left by the previous test, which calls revokeObjectURL
  clearBlobCache()
  vi.mocked(downloadFile).mockReset()
})

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('useAssetMedia navigation', () => {
  it('drops the stale full image and exposes the cached md placeholder while the next file loads', async () => {
    const download = vi.mocked(downloadFile)
    download.mockResolvedValueOnce({ size: 8 } as Blob) // asset A's xl resolves
    download.mockImplementation(never) // asset B's xl is on a slow connection

    const { getByTestId, rerender } = render(<Probe asset={assetA} />)
    await waitFor(() => expect(getByTestId('image').textContent).toMatch(/^blob:/))

    // the strip rendered asset B's md before the click, so it is in the blob cache
    await getCachedBlobUrl(viewerThumbKey(bMd), () => Promise.resolve({ size: 8 } as Blob))
    rerender(<Probe asset={assetB} />)

    // no stale full image, spinner on, blurred md stand-in available
    expect(getByTestId('image').textContent).toBe('none')
    expect(getByTestId('loading').textContent).toBe('true')
    expect(getByTestId('placeholder').textContent).toMatch(/^blob:/)
  })

  it('renders a prefetched viewer thumb without a loading flash', async () => {
    vi.mocked(downloadFile).mockImplementation(never)

    const { getByTestId, rerender } = render(<Probe asset={assetA} />)
    const prefetched = await getCachedBlobUrl(viewerThumbKey(bXl), () =>
      Promise.resolve({ size: 8 } as Blob),
    )
    rerender(<Probe asset={assetB} />)

    expect(getByTestId('image').textContent).toBe(prefetched)
    expect(getByTestId('loading').textContent).toBe('false')
  })
})
