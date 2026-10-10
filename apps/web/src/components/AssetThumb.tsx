import { useEffect, useRef, useState } from 'react'
import { FaSpinner, FaTriangleExclamation } from 'react-icons/fa6'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { getFileStreamUrl } from '../api/assets'
import { whenScrollIdle } from '../lib/scrollIdle'
import { observeIntersecting } from '../lib/shared-intersection'
import { TIMELINE_PREFETCH_PX } from '../lib/timelineLayout'
import { useScrollContainer } from './AppShell'
import { Skeleton } from './Skeleton'

interface AssetThumbProps {
  asset: Asset
  className?: string
  onThumbPicked?: (thumb: AssetThumbnail) => void
  /**
   * Skip the intersection gate entirely. The observer's root is the timeline's <main>, and a
   * position:fixed element (viewer strip/related tray, dialogs) never intersects a non-viewport
   * root — its rect reports empty forever, so gated thumbs would stay Skeleton. Use for contexts
   * that are always on-screen once mounted.
   */
  eager?: boolean
}

export function AssetThumb({
  asset,
  className = '',
  onThumbPicked,
  eager = false,
}: AssetThumbProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(eager)
  // Keyed by fileId so a different asset on the same component instance is not stuck on the fallback.
  const [failedFileId, setFailedFileId] = useState<string | null>(null)
  const scrollContainer = useScrollContainer()
  const thumb = asset.thumbnails?.find((t) => t.size === 'md') ?? asset.thumbnails?.[0]

  useEffect(() => {
    if (eager) return
    const el = ref.current
    if (!el) return
    let cancelIdle: (() => void) | undefined
    const cleanup = observeIntersecting(
      el,
      // root = the timeline's own scroller, not the viewport. An ancestor scroll container clips the
      // intersection rectangle, so a viewport rootMargin is trimmed back to <main>'s visible edge and
      // never prefetches anything off screen. The observer is shared per scroll root (see
      // lib/shared-intersection), and the margin is the shared timeline constant so it stays within
      // TimelineGrid's mount window — a wider margin observes tiles that aren't in the DOM. Absolute
      // lengths only: vh/rem make the constructor throw SyntaxError.
      scrollContainer?.current ?? null,
      `${TIMELINE_PREFETCH_PX}px 0px`,
      (entry) => {
        if (!entry.isIntersecting) return
        cleanup?.()
        // Arm on scroll settle (shared) rather than per-tile entry: every visible tile starts
        // its download at the same moment, so thumbs pop in together instead of in scroll order.
        cancelIdle = whenScrollIdle(() => setVisible(true))
      },
    )
    return () => {
      cancelIdle?.()
      cleanup?.()
    }
  }, [scrollContainer, eager])

  useEffect(() => {
    if (!visible) return
    if (asset.kind !== 'photo' && asset.kind !== 'video') return
    if (!thumb) return
    onThumbPicked?.(thumb)
  }, [asset.id, asset.kind, visible])

  const thumbFileId = thumb?.fileId ?? null
  const src = visible && thumbFileId ? getFileStreamUrl(thumbFileId) : null
  const error = failedFileId !== null && failedFileId === thumbFileId
  const isVideo = asset.kind === 'video'
  const transcodeStatus = isVideo ? asset.transcodeStatus : null

  return (
    <div ref={ref} className={`relative w-full h-full ${className}`}>
      {error ? (
        <div className="w-full h-full bg-slate-800 flex items-center justify-center">
          <span className="text-xs text-slate-500">No preview</span>
        </div>
      ) : !src ? (
        <Skeleton className="w-full h-full" />
      ) : (
        <>
          <img
            src={src}
            alt={
              isVideo
                ? (asset.originalName ?? asset.title ?? 'Video')
                : (asset.originalName ?? asset.title ?? 'Photo')
            }
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailedFileId(thumbFileId)}
          />
          {isVideo && transcodeStatus === 'pending' && (
            <div className="absolute top-2 left-2 pointer-events-none" aria-label="Transcoding">
              <div className="bg-black/65 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-semibold text-white inline-flex items-center gap-1">
                <FaSpinner className="text-[10px] animate-spin" />
                <span>Transcoding</span>
              </div>
            </div>
          )}
          {isVideo && transcodeStatus === 'failed' && (
            <div
              className="absolute top-2 right-2 pointer-events-none"
              aria-label="Transcode failed"
            >
              <div className="bg-amber-500/90 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center">
                <FaTriangleExclamation className="text-white text-[12px]" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
