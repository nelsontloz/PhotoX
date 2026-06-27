import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VideoPlayer } from './VideoPlayer'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function getVideo(): HTMLVideoElement {
  const el = document.querySelector('video')
  if (!el) throw new Error('No <video> element found')
  return el
}

describe('VideoPlayer', () => {
  it('renders a video element with the right src and poster', () => {
    render(
      <VideoPlayer src="/api/v1/files/abc/stream?userId=u1" poster="/poster.jpg" title="Trip" />,
    )

    const video = getVideo()
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toBe('/api/v1/files/abc/stream?userId=u1')
    expect(video.getAttribute('poster')).toBe('/poster.jpg')
  })

  it('applies playsInline and preload="metadata"', () => {
    render(<VideoPlayer src="/api/v1/files/abc/stream?userId=u1" title="Trip" />)

    const video = getVideo()
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(video.getAttribute('preload')).toBe('metadata')
  })

  it('shows an accessible aria-label using the title', () => {
    render(<VideoPlayer src="/api/v1/files/abc/stream?userId=u1" title="Birthday" />)

    expect(getVideo().getAttribute('aria-label')).toBe('Video player for Birthday')
  })

  it('falls back to a generic aria-label when no title is provided', () => {
    render(<VideoPlayer src="/api/v1/files/abc/stream?userId=u1" />)

    expect(getVideo().getAttribute('aria-label')).toBe('Video player')
  })

  it('shows the error fallback when the video fires an error event', () => {
    render(<VideoPlayer src="/api/v1/files/abc/stream?userId=u1" title="Birthday" />)

    const video = getVideo()
    fireEvent.error(video)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(`Can't play "Birthday"`)
    expect(alert.textContent).toContain("isn't supported by your browser")
  })

  it('falls back to fallbackSrc when the primary src errors', () => {
    const { container } = render(
      <VideoPlayer
        src="/api/v1/files/primary/stream?userId=u1"
        fallbackSrc="/api/v1/files/orig/stream?userId=u1"
        title="Trip"
      />,
    )
    const video = container.querySelector('video')!
    expect(video.src).toContain('/primary/stream')
    fireEvent.error(video)
    expect(video.src).toContain('/orig/stream')
  })

  it('hides the loading overlay once metadata is loaded', () => {
    render(<VideoPlayer src="/api/v1/files/abc/stream?userId=u1" title="Trip" />)

    expect(screen.queryByText(/Loading video/i)).not.toBeNull()

    fireEvent.loadedMetadata(getVideo())

    expect(screen.queryByText(/Loading video/i)).toBeNull()
  })
})
