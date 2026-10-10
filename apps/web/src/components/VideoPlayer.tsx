import { useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'
import { FaCircleExclamation } from 'react-icons/fa6'

interface VideoPlayerProps {
  src: string
  fallbackSrc?: string
  // video.js picks sources via canPlayType(type): a missing type is rejected — pass a real mime.
  type?: string
  fallbackType?: string
  poster?: string
  title?: string
  className?: string
  autoPlay?: boolean
  /** width / height of the video; sizes the frame so portrait videos stay tall (defaults to 16:9). */
  aspectRatio?: number
}

export function VideoPlayer({
  src,
  fallbackSrc,
  type = 'video/mp4',
  fallbackType,
  poster,
  title,
  className = '',
  autoPlay = false,
  aspectRatio = 16 / 9,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (error) return
    const container = containerRef.current
    if (!container) return

    // React owns only the container: video.js dispose() removes its own element, which breaks a
    // JSX-rendered node under StrictMode's double effect (legacy.videojs.org/guides/react).
    const videoEl = document.createElement('video-js')
    videoEl.classList.add('vjs-big-play-centered')
    videoEl.setAttribute('aria-label', title ? `Video player for ${title}` : 'Video player')
    container.appendChild(videoEl)

    let swapped = false
    const player: Player = videojs(videoEl, {
      controls: true,
      autoplay: autoPlay,
      playsinline: true,
      preload: 'metadata',
      fill: true,
      poster,
      sources: [{ src, type }],
    })

    player.on('error', () => {
      if (!swapped && fallbackSrc) {
        swapped = true
        player.error(null)
        player.src({ src: fallbackSrc, type: fallbackType ?? type })
        return
      }
      setError(true)
    })

    return () => {
      if (!player.isDisposed()) player.dispose()
    }
  }, [error, src, type, fallbackSrc, fallbackType, poster, title, autoPlay])

  if (error) {
    return (
      <div
        role="alert"
        className={[
          'flex flex-col items-center justify-center gap-3',
          'w-full aspect-video max-h-[80vh]',
          'bg-slate-100 dark:bg-card-dark',
          'border border-slate-200 dark:border-border-dark',
          'rounded-xl text-slate-500 dark:text-slate-400',
          'p-6 text-center',
          className,
        ].join(' ')}
      >
        <FaCircleExclamation className="text-4xl text-amber-500 dark:text-amber-400" />
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {title ? `Can't play "${title}"` : "This video can't be played"}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This video format isn't supported by your browser.
        </p>
      </div>
    )
  }

  // Width follows the video's aspect ratio (height capped at 80vh), so the frame hugs the video
  // instead of staying full-width with letterbox bars.
  return (
    <div
      className={['relative bg-black rounded-xl overflow-hidden shadow-2xl', className].join(' ')}
      style={{ width: `min(100%, calc(80vh * ${aspectRatio}))`, aspectRatio }}
    >
      <div data-vjs-player className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
