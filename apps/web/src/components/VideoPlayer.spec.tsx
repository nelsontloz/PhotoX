import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { VideoPlayer } from './VideoPlayer'

// jsdom cannot run the real video.js (it needs a media stack) — the module is mocked below.
const videojsMock = vi.hoisted(() => {
  const handlers: { event: string; handler: () => void }[] = []
  const player = {
    on: vi.fn((event: string, handler: () => void) => {
      handlers.push({ event, handler })
    }),
    isDisposed: vi.fn(() => false),
    dispose: vi.fn(),
    error: vi.fn(),
    src: vi.fn(),
  }
  const initCalls: { element: Element; options: unknown }[] = []
  const fn = vi.fn((element: Element, options: unknown) => {
    initCalls.push({ element, options })
    return player
  })
  return { fn, player, handlers, initCalls }
})

vi.mock('video.js', () => ({ default: videojsMock.fn }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  videojsMock.handlers.length = 0
  videojsMock.initCalls.length = 0
})

function initCall(): { element: Element; options: Record<string, unknown> } {
  const call = videojsMock.initCalls[0]
  if (!call) throw new Error('videojs was not called')
  return { element: call.element, options: call.options as Record<string, unknown> }
}

function errorHandler(): () => void {
  const entry = videojsMock.handlers.find((h) => h.event === 'error')
  if (!entry) throw new Error('no error handler was registered')
  return entry.handler
}

describe('VideoPlayer', () => {
  it('initializes video.js on a created element with the right aria-label and options', () => {
    render(<VideoPlayer src="/api/v1/files/abc/stream" poster="/poster.jpg" title="Trip" />)

    expect(videojsMock.fn).toHaveBeenCalledTimes(1)
    const { element, options } = initCall()
    expect(element.tagName.toLowerCase()).toBe('video-js')
    expect(element.getAttribute('aria-label')).toBe('Video player for Trip')
    expect(options).toMatchObject({
      controls: true,
      autoplay: false,
      playsinline: true,
      preload: 'metadata',
      fill: true,
      poster: '/poster.jpg',
      sources: [{ src: '/api/v1/files/abc/stream', type: 'video/mp4' }],
    })
  })

  it('uses a generic aria-label and honours autoPlay', () => {
    render(<VideoPlayer src="/api/v1/files/abc/stream" autoPlay />)

    const { element, options } = initCall()
    expect(element.getAttribute('aria-label')).toBe('Video player')
    expect(options.autoplay).toBe(true)
  })

  it('sizes the frame from the video aspect ratio instead of a full-width box', () => {
    const { container } = render(<VideoPlayer src="/api/v1/files/abc/stream" aspectRatio={2} />)

    const frame = container.firstElementChild as HTMLElement
    // jsdom normalizes the calc (160vh); match either form — the point is the ratio-aware sizing
    expect(frame.style.width).toMatch(/^min\(100%, .*vh\)$/)
    expect(frame.style.aspectRatio).toBe('2')
  })

  it('swaps to fallbackSrc on the first player error', () => {
    render(
      <VideoPlayer
        src="/api/v1/files/primary/stream"
        type="video/webm"
        fallbackSrc="/api/v1/files/orig/stream"
        fallbackType="video/mp4"
        title="Trip"
      />,
    )

    const fireError = errorHandler()
    act(() => {
      fireError()
    })

    expect(videojsMock.player.error).toHaveBeenCalledWith(null)
    expect(videojsMock.player.src).toHaveBeenCalledWith({
      src: '/api/v1/files/orig/stream',
      type: 'video/mp4',
    })
    expect(videojsMock.player.dispose).not.toHaveBeenCalled()
  })

  it('shows the error card and disposes the player when the fallback also fails', () => {
    render(
      <VideoPlayer
        src="/api/v1/files/primary/stream"
        fallbackSrc="/api/v1/files/orig/stream"
        title="Birthday"
      />,
    )

    const fireError = errorHandler()
    act(() => {
      fireError()
    })
    act(() => {
      fireError()
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(`Can't play "Birthday"`)
    expect(alert.textContent).toContain("isn't supported by your browser")
    expect(videojsMock.player.dispose).toHaveBeenCalled()
  })

  it('shows the error card on the first error when no fallback is provided', () => {
    render(<VideoPlayer src="/api/v1/files/abc/stream" />)

    const fireError = errorHandler()
    act(() => {
      fireError()
    })

    expect(screen.getByRole('alert').textContent).toContain("This video can't be played")
  })

  it('disposes the player on unmount', () => {
    const { unmount } = render(<VideoPlayer src="/api/v1/files/abc/stream" />)

    unmount()

    expect(videojsMock.player.dispose).toHaveBeenCalled()
  })
})
