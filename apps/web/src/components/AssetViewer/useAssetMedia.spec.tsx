import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { Asset, AssetThumbnail } from '@photox/shared-types'

import { useAssetMedia } from './useAssetMedia'

const aXl = { fileId: 'a-xl', size: 'xl', width: 4, height: 3 } as AssetThumbnail
const bMd = { fileId: 'b-md', size: 'md', width: 4, height: 3 } as AssetThumbnail
const bXl = { fileId: 'b-xl', size: 'xl', width: 4, height: 3 } as AssetThumbnail

const assetA = { id: 'a', kind: 'photo', fileId: 'a-xl', thumbnails: [aXl] } as Asset
// same id/kind as assetA, thumbnails not ready yet (viewer opened before processing finished)
const assetLate = { id: 'a', kind: 'photo', fileId: 'a-xl' } as Asset
const assetB = { id: 'b', kind: 'photo', fileId: 'b-xl', thumbnails: [bMd, bXl] } as Asset

const never = () => new Promise<void>(() => undefined)

// jsdom has no HTMLImageElement.decode; the stub is also the seam that holds a "slow connection" open.
const decodeMock = vi.fn<() => Promise<void>>()
class ImageStub {
  src = ''
  decode(): Promise<void> {
    return decodeMock()
  }
}

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

beforeEach(() => {
  decodeMock.mockReset()
  decodeMock.mockResolvedValue(undefined)
  vi.stubGlobal('Image', ImageStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAssetMedia navigation', () => {
  it('drops the stale full image and exposes the direct md placeholder while the next file loads', async () => {
    decodeMock.mockResolvedValueOnce(undefined) // asset A's xl decodes
    decodeMock.mockImplementation(never) // asset B's xl is on a slow connection

    const { getByTestId, rerender } = render(<Probe asset={assetA} />)
    await waitFor(() => expect(getByTestId('image').textContent).toBe('/api/v1/files/a-xl/stream'))

    rerender(<Probe asset={assetB} />)

    // no stale full image, spinner on, md stand-in available synchronously
    expect(getByTestId('image').textContent).toBe('none')
    expect(getByTestId('loading').textContent).toBe('true')
    expect(getByTestId('placeholder').textContent).toBe('/api/v1/files/b-md/stream')
  })

  it('swaps the viewer image in only after the preload decode resolves', async () => {
    const { getByTestId, rerender } = render(<Probe asset={assetA} />)
    await waitFor(() => expect(getByTestId('image').textContent).toBe('/api/v1/files/a-xl/stream'))

    let finishDecode!: () => void
    decodeMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishDecode = resolve
      }),
    )
    rerender(<Probe asset={assetB} />)

    // b-xl is still decoding: the previous image must be gone and no URL swapped in yet
    expect(getByTestId('image').textContent).toBe('none')
    expect(getByTestId('loading').textContent).toBe('true')

    act(() => {
      finishDecode()
    })
    await waitFor(() => expect(getByTestId('image').textContent).toBe('/api/v1/files/b-xl/stream'))
  })

  it('falls back to the no-preview state when the preload decode fails', async () => {
    decodeMock.mockRejectedValue(new Error('stream failed'))

    const { getByTestId } = render(<Probe asset={assetA} />)

    // ViewerMedia reads this as "not loading, no URL" → its No preview available branch
    await waitFor(() => expect(getByTestId('loading').textContent).toBe('false'))
    expect(getByTestId('image').textContent).toBe('none')
  })

  it('picks up thumbnails that arrive after mount (same id and kind)', async () => {
    const { getByTestId, rerender } = render(<Probe asset={assetLate} />)

    // no thumb yet: nothing to load, not stuck spinning
    expect(getByTestId('image').textContent).toBe('none')
    expect(getByTestId('loading').textContent).toBe('false')

    rerender(<Probe asset={assetA} />)

    await waitFor(() => expect(getByTestId('image').textContent).toBe('/api/v1/files/a-xl/stream'))
  })
})
