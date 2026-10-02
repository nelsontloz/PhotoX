import { useEffect, useRef, useState } from 'react'
import { FaSpinner, FaTriangleExclamation } from 'react-icons/fa6'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { downloadFile } from '../api/assets'
import { viewerThumbKey } from '../lib/asset-media'
import { getCachedBlobUrl, peekCachedBlobUrl } from '../lib/blob-cache'
import { whenScrollIdle } from '../lib/scrollIdle'
import { TIMELINE_PREFETCH_PX } from '../lib/timelineLayout'
import { useThumbStore } from '../store/thumb-store'
import { useScrollContainer } from './AppShell'
import { Skeleton } from './Skeleton'

interface AssetThumbProps {
  asset: Asset
  className?: string
  onThumbPicked?: (thumb: AssetThumbnail) => void
}

export function AssetThumb({ asset, className = '', onThumbPicked }: AssetThumbProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const localThumb = useThumbStore((s) => s.urls[asset.fileId])
  const scrollContainer = useScrollContainer()
  const thumb = asset.thumbnails?.find((t) => t.size === 'md') ?? asset.thumbnails?.[0]
  // The timeline unmounts off-window days, so a loaded tile remounts on scroll-back. Seed from the
  // cache synchronously (peek, as FaceThumb/useAssetMedia do) so it stays painted — waiting for the
  // idle gate or a promise tick would flash a Skeleton over an already-downloaded thumb.
  const [objectUrl, setObjectUrl] = useState<string | null>(() =>
    thumb ? (peekCachedBlobUrl(viewerThumbKey(thumb)) ?? null) : null,
  )
  const [error, setError] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelIdle: (() => void) | undefined
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.unobserve(entry.target)
          // Arm on scroll settle (shared) rather than per-tile entry: every visible tile starts
          // its download at the same moment, so thumbs pop in together instead of in scroll order.
          cancelIdle = whenScrollIdle(() => setVisible(true))
        }
      },
      // root = the timeline's own scroller, not the viewport. An ancestor scroll container clips the
      // intersection rectangle, so a viewport rootMargin is trimmed back to <main>'s visible edge and
      // never prefetches anything off screen. The margin is the shared timeline constant so it stays
      // within TimelineGrid's mount window — a wider margin observes tiles that aren't in the DOM.
      // Absolute lengths only: vh/rem make the constructor throw SyntaxError.
      {
        root: scrollContainer?.current ?? null,
        rootMargin: `${TIMELINE_PREFETCH_PX}px 0px`,
      },
    )
    io.observe(el)
    return () => {
      cancelIdle?.()
      io.disconnect()
    }
  }, [scrollContainer])

  useEffect(() => {
    if (!visible) return
    let cancelled = false

    if (asset.kind !== 'photo' && asset.kind !== 'video') return

    if (!thumb) return

    onThumbPicked?.(thumb)
    // The shared cache owns download + URL lifetime; no abort here, so a tile scrolling away
    // still populates the cache for the next mount or the viewer.
    getCachedBlobUrl(viewerThumbKey(thumb), () => downloadFile(thumb.fileId))
      .then((url) => {
        if (!cancelled) setObjectUrl(url)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      cancelled = true
    }
  }, [asset.id, asset.kind, visible])

  const src = localThumb ?? objectUrl
  const isVideo = asset.kind === 'video'
  const transcodeStatus = isVideo ? asset.transcodeStatus : null

  return (
    <div ref={ref} className={`relative w-full h-full ${className}`}>
      {error && !src ? (
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
            draggable={false}
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
