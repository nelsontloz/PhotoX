import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VideoPlayer } from './VideoPlayer'

afterEach(cleanup)

function videoEl(container: HTMLElement): HTMLVideoElement {
  const el = container.querySelector('video')
  if (!el) throw new Error('no <video> rendered')
  return el
}

describe('VideoPlayer', () => {
  it('renders a native video with native controls, inline playback and metadata preload', () => {
    const { container } = render(
      <VideoPlayer src="/api/v1/files/abc/stream" poster="/poster.jpg" title="Trip" />,
    )
    const video = videoEl(container)

    expect(video.getAttribute('src')).toBe('/api/v1/files/abc/stream')
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(video.getAttribute('preload')).toBe('metadata')
    expect(video.getAttribute('poster')).toBe('/poster.jpg')
    expect(video.hasAttribute('autoplay')).toBe(false)
    expect(video.getAttribute('aria-label')).toBe('Video player for Trip')
    // the frame is the same box the previous player used
    expect(video.parentElement!.classList.contains('video-frame')).toBe(true)
  })

  it('uses a generic aria-label and honours autoPlay', () => {
    const { container } = render(<VideoPlayer src="/api/v1/files/abc/stream" autoPlay />)
    const video = videoEl(container)

    expect(video.getAttribute('aria-label')).toBe('Video player')
    expect(video.hasAttribute('autoplay')).toBe(true)
  })

  it('sizes the frame from the video aspect ratio instead of a full-width box', () => {
    const { container } = render(<VideoPlayer src="/api/v1/files/abc/stream" aspectRatio={2} />)

    const frame = container.firstElementChild as HTMLElement
    // .video-frame in app.css fits the container box (cq units) using this variable
    expect(frame.classList.contains('video-frame')).toBe(true)
    expect(frame.style.getPropertyValue('--video-ar')).toBe('2')
  })

  it('renders one progressive source with no mime hint', () => {
    const { container } = render(<VideoPlayer src="/api/v1/files/abc/stream" />)
    const video = videoEl(container)

    expect(video.getAttribute('src')).toBe('/api/v1/files/abc/stream')
    expect(video.getAttribute('type')).toBeNull()
  })

  it('swaps to fallbackSrc on the first error', () => {
    const { container } = render(
      <VideoPlayer
        src="/api/v1/files/primary/stream"
        fallbackSrc="/api/v1/files/orig/stream"
        title="Trip"
      />,
    )
    const video = videoEl(container)

    fireEvent.error(video)

    expect(videoEl(container).getAttribute('src')).toBe('/api/v1/files/orig/stream')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the error card when the fallback also fails', () => {
    const { container } = render(
      <VideoPlayer
        src="/api/v1/files/primary/stream"
        fallbackSrc="/api/v1/files/orig/stream"
        title="Birthday"
      />,
    )

    fireEvent.error(videoEl(container))
    fireEvent.error(videoEl(container))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(`Can't play "Birthday"`)
    expect(alert.textContent).toContain("isn't supported by your browser")
  })

  it('shows the error card on the first error when no fallback is provided', () => {
    const { container } = render(<VideoPlayer src="/api/v1/files/abc/stream" />)

    fireEvent.error(videoEl(container))

    expect(screen.getByRole('alert').textContent).toContain("This video can't be played")
  })
})
