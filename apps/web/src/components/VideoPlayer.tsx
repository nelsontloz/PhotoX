import { useState } from 'react'
import { FaCircleExclamation, FaSpinner, FaVideo } from 'react-icons/fa6'

export interface VideoPlayerProps {
  src: string
  poster?: string
  title?: string
  autoPlay?: boolean
  className?: string
}

export function VideoPlayer({
  src,
  poster,
  title,
  autoPlay = false,
  className = '',
}: VideoPlayerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const label = title ? `Video player for ${title}` : 'Video player'

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
        src={src}
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
