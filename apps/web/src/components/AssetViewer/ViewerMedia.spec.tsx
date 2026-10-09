import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { Asset } from '@photox/shared-types'
import { ViewerMedia } from './ViewerMedia'

const asset = { id: 'a1', kind: 'photo', width: 400, height: 300 } as Asset

function renderMedia(overrides: {
  loading?: boolean
  imageUrl?: string | null
  placeholderUrl?: string | null
}) {
  return render(
    <ViewerMedia
      isVideo={false}
      videoSrc={null}
      videoFallbackSrc={undefined}
      videoPoster={undefined}
      videoTitle={undefined}
      imageUrl={overrides.imageUrl ?? null}
      imageAlt="Photo"
      loading={overrides.loading ?? false}
      placeholderUrl={overrides.placeholderUrl ?? null}
      hasPrev={false}
      hasNext={false}
      infoOpen={false}
      asset={asset}
    />,
  )
}

describe('ViewerMedia loading placeholder', () => {
  it('renders the cached md thumb in the image slot with the final image box rules', () => {
    const { container } = renderMedia({ loading: true, placeholderUrl: 'blob:mock-md' })

    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('blob:mock-md')
    // intrinsic dims + max-constrained contain: same box the full image will take
    expect(img?.getAttribute('width')).toBe('400')
    expect(img?.getAttribute('height')).toBe('300')
    expect(img?.className).toContain('object-contain')
    expect(img?.className).toContain('blur-2xl')
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('still reserves the image box when the md thumb is not cached', () => {
    const { container } = renderMedia({ loading: true })

    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/^data:image\/gif/)
    expect(img?.getAttribute('width')).toBe('400')
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('shows No preview available on failure', () => {
    const { getByText } = renderMedia({})
    expect(getByText('No preview available')).toBeTruthy()
  })
})
