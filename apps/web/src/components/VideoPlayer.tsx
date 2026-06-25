import { useEffect, useRef, useState } from 'react'
import { FaCircleExclamation, FaSpinner, FaVideo } from 'react-icons/fa6'
import type { TranscodeStatus } from '@photox/shared-types'
import { getAuthHeaderValue } from '../lib/authHeader'

export interface VideoPlayerProps {
  src: string
  hlsSrc?: string
  poster?: string
  title?: string
  autoPlay?: boolean
  className?: string
  transcodeStatus?: TranscodeStatus
}

export function VideoPlayer({
  src,
  hlsSrc,
  poster,
  title,
  autoPlay = false,
  className = '',
  transcodeStatus,
}: VideoPlayerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const label = title ? `Video player for ${title}` : 'Video player'
  const useTranscoded = transcodeStatus === 'ready'
  const playableSrc = useTranscoded && hlsSrc ? hlsSrc : src

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!useTranscoded || !hlsSrc) return
    if (typeof window === 'undefined') return

    let cancelled = false
    let hlsInstance: { destroy: () => void } | null = null

    void (async () => {
      try {
        const mod = await import('hls.js')
        if (cancelled) return
        const Hls = mod.default
        if (Hls.isSupported()) {
          const hls = new Hls({
            xhrSetup: (xhr) => {
              const header = getAuthHeaderValue()
              if (header) {
                xhr.setRequestHeader('Authorization', header)
              }
            },
          })
          hls.loadSource(hlsSrc)
          hls.attachMedia(video)
          if (cancelled) {
            hls.destroy()
            return
          }
          hlsInstance = hls
        } else {
          video.src = src
        }
      } catch {
        if (!cancelled) video.src = src
      }
    })()

    return () => {
      cancelled = true
      if (hlsInstance) {
        hlsInstance.destroy()
      }
    }
  }, [hlsSrc, src, useTranscoded])

  if (transcodeStatus === 'pending') {
    return (
      <div
        role="status"
        aria-live="polite"
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
        <FaSpinner className="text-4xl text-primary animate-spin" />
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Transcoding…</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Preparing this video for streaming…
        </p>
      </div>
    )
  }

  if (transcodeStatus === 'failed') {
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
          This video couldn't be processed
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          You can still watch the original file.
        </p>
        <a
          href={src}
          download
          className="text-xs font-semibold text-primary hover:text-primary/80 hover:underline"
        >
          Try the original quality
        </a>
      </div>
    )
  }

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

  return (
    <div
      className={[
        'relative w-full max-h-[80vh] bg-black rounded-xl overflow-hidden shadow-2xl',
        className,
      ].join(' ')}
    >
      <video
        ref={videoRef}
        src={playableSrc}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        muted={autoPlay}
        autoPlay={autoPlay}
        aria-label={label}
        onLoadedMetadata={() => {
          setLoading(false)
        }}
        onError={() => {
          setLoading(false)
          setError(true)
        }}
        className="block w-full h-full max-h-[80vh] object-contain"
      >
        <track kind="captions" />
      </video>
      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none"
          aria-hidden="true"
        >
          <div className="flex flex-col items-center gap-2 text-slate-200">
            <FaSpinner className="text-3xl text-primary animate-spin" />
            <span className="text-xs text-slate-300 inline-flex items-center gap-1.5">
              <FaVideo className="text-xs" />
              Loading video…
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
