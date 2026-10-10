import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'

// count renders instead of DOM: the memo bailout is observable as "AssetThumb not called again"
vi.mock('./AssetThumb', () => ({ AssetThumb: vi.fn(() => null) }))

import { GalleryItem } from './GalleryItem'
import { AssetThumb } from './AssetThumb'

const AssetThumbMock = vi.mocked(AssetThumb)

const asset = { id: 'a', kind: 'photo' } as Asset

describe('GalleryItem memoization', () => {
  it('bails out on shallow-equal props and re-renders when selected flips', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <GalleryItem asset={asset} onSelect={onSelect} showCheckbox={false} />,
    )
    expect(AssetThumbMock).toHaveBeenCalledTimes(1)

    rerender(<GalleryItem asset={asset} onSelect={onSelect} showCheckbox={false} />)
    expect(AssetThumbMock).toHaveBeenCalledTimes(1)

    rerender(<GalleryItem asset={asset} onSelect={onSelect} showCheckbox={false} selected />)
    expect(AssetThumbMock).toHaveBeenCalledTimes(2)
  })
})

describe('GalleryItem eager forwarding', () => {
  it('passes eager through to AssetThumb for fixed-overlay contexts', () => {
    AssetThumbMock.mockClear()
    render(<GalleryItem asset={asset} eager showCheckbox={false} />)

    const props = AssetThumbMock.mock.calls.at(-1)?.[0] as { eager?: boolean } | undefined
    expect(props?.eager).toBe(true)
  })
})
