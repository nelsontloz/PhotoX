import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VideoPlayer } from './VideoPlayer'

const mockHls = {
  isSupported: vi.fn(() => true),
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
}

vi.mock('hls.js', () => ({
  default: class {
    static isSupported() {
      return mockHls.isSupported()
    }
    loadSource(src: string) {
      mockHls.loadSource(src)
    }
    attachMedia(video: HTMLMediaElement) {
      mockHls.attachMedia(video)
    }
    destroy() {
      mockHls.destroy()
    }
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function getVideo(): HTMLVideoElement {
  const el = document.querySelector('video')
  if (!el) throw new Error('No <video> element found')
  return el
}

function setNativeHls(supported: boolean): void {
  const video = document.createElement('video')
  Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', {
    configurable: true,
    value: vi.fn((type: string) => {
      if (type === 'application/vnd.apple.mpegurl') {
        return supported ? 'probably' : ''
      }
      return ''
    }),
  })
  void video
}

describe('VideoPlayer', () => {
  beforeEach(() => {
    mockHls.isSupported.mockReturnValue(true)
    mockHls.loadSource.mockClear()
    mockHls.attachMedia.mockClear()
    mockHls.destroy.mockClear()
  })

  it('renders a video element with the right src and poster', () => {
    render(
      <VideoPlayer
        src="/v1/videos/abc/stream?userId=u1"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        poster="/poster.jpg"
        title="Trip"
        transcodeStatus="ready"
      />,
    )

    const video = getVideo()
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toBe('/v1/videos/abc/playlist.m3u8')
    expect(video.getAttribute('poster')).toBe('/poster.jpg')
  })

  it('falls back to the direct MP4 src when no hlsSrc is provided', () => {
    render(<VideoPlayer src="/v1/videos/abc/stream" title="Trip" />)

    expect(getVideo().getAttribute('src')).toBe('/v1/videos/abc/stream')
  })

  it('applies playsInline and preload="metadata"', () => {
    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Trip"
        transcodeStatus="ready"
      />,
    )

    const video = getVideo()
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(video.getAttribute('preload')).toBe('metadata')
  })

  it('shows an accessible aria-label using the title', () => {
    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Birthday"
        transcodeStatus="ready"
      />,
    )

    expect(getVideo().getAttribute('aria-label')).toBe('Video player for Birthday')
  })

  it('falls back to a generic aria-label when no title is provided', () => {
    render(<VideoPlayer src="/v1/videos/abc/stream" />)

    expect(getVideo().getAttribute('aria-label')).toBe('Video player')
  })

  it('shows the transcoding state without loading a video', () => {
    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Trip"
        transcodeStatus="pending"
      />,
    )

    expect(document.querySelector('video')).toBeNull()
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Transcoding')
    expect(status.textContent).toContain('Preparing this video for streaming')
  })

  it('shows the failed state with a fallback link to the original quality', async () => {
    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Trip"
        transcodeStatus="failed"
      />,
    )

    expect(document.querySelector('video')).toBeNull()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain("couldn't be processed")

    const button = screen.getByRole('button', { name: /original quality/i })
    fireEvent.click(button)

    await waitFor(() => {
      const video = getVideo()
      expect(video.getAttribute('src')).toBe('/v1/videos/abc/stream')
    })
  })

  it('shows the error fallback when the video fires an error event', () => {
    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Birthday"
        transcodeStatus="ready"
      />,
    )

    const video = getVideo()
    fireEvent.error(video)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(`Can't play "Birthday"`)
    expect(alert.textContent).toContain("isn't supported by your browser")
  })

  it('hides the loading overlay once metadata is loaded', () => {
    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Trip"
        transcodeStatus="ready"
      />,
    )

    expect(screen.queryByText(/Loading video/i)).not.toBeNull()

    fireEvent.loadedMetadata(getVideo())

    expect(screen.queryByText(/Loading video/i)).toBeNull()
  })

  it('uses native HLS when canPlayType returns "maybe"', async () => {
    setNativeHls(true)

    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Trip"
        transcodeStatus="ready"
      />,
    )

    await waitFor(() => {
      expect(getVideo().getAttribute('src')).toBe('/v1/videos/abc/playlist.m3u8')
    })
    expect(mockHls.loadSource).not.toHaveBeenCalled()
  })

  it('uses hls.js when Hls.isSupported() is true and native HLS is unavailable', async () => {
    setNativeHls(false)

    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Trip"
        transcodeStatus="ready"
      />,
    )

    await waitFor(() => {
      expect(mockHls.loadSource).toHaveBeenCalledWith('/v1/videos/abc/playlist.m3u8')
    })
    expect(mockHls.attachMedia).toHaveBeenCalled()
  })

  it('falls back to the direct MP4 when hls.js is not supported', async () => {
    setNativeHls(false)
    mockHls.isSupported.mockReturnValueOnce(false)

    render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Trip"
        transcodeStatus="ready"
      />,
    )

    await waitFor(() => {
      expect(getVideo().getAttribute('src')).toBe('/v1/videos/abc/stream')
    })
    expect(mockHls.loadSource).not.toHaveBeenCalled()
  })

  it('calls hls.destroy() on unmount', async () => {
    setNativeHls(false)

    const { unmount } = render(
      <VideoPlayer
        src="/v1/videos/abc/stream"
        hlsSrc="/v1/videos/abc/playlist.m3u8"
        title="Trip"
        transcodeStatus="ready"
      />,
    )

    await waitFor(() => {
      expect(mockHls.loadSource).toHaveBeenCalled()
    })

    unmount()

    expect(mockHls.destroy).toHaveBeenCalled()
  })
})
