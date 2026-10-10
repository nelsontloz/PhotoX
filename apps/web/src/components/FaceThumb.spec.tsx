import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import { FaceThumb } from './FaceThumb'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FaceThumb', () => {
  it('requests the cookie-authenticated thumb URL while the Skeleton shows', () => {
    const { container } = render(<FaceThumb faceId="face-1" alt="Alice" />)

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/faces/face-1/thumb')
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('encodes the face id in the URL', () => {
    const { container } = render(<FaceThumb faceId="face/1" alt="Alice" />)

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/faces/face%2F1/thumb')
  })

  it('reveals the loaded image once the thumb decodes', () => {
    const { container } = render(<FaceThumb faceId="face-1" alt="Alice" />)

    fireEvent.load(container.querySelector('img')!)

    const img = container.querySelector('img')
    expect(img?.getAttribute('alt')).toBe('Alice')
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('falls back to the icon when the thumb fails', () => {
    const { container } = render(<FaceThumb faceId="face-1" alt="Alice" />)

    fireEvent.error(container.querySelector('img')!)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
