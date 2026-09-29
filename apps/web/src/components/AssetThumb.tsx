import { useEffect, useRef, useState } from 'react'
import { FaSpinner, FaTriangleExclamation } from 'react-icons/fa6'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { downloadFile } from '../api/assets'
import { useThumbStore } from '../store/thumb-store'
import { Skeleton } from './Skeleton'

interface AssetThumbProps {
  asset: Asset
  className?: string
  onThumbPicked?: (thumb: AssetThumbnail) => void
}

const THUMB_SIZES = ['md']
const LOAD_DELAY_MS = 300

// ponytail: session-long objectURL cache keyed by thumb fileId — timeline virtualization remounts
// tiles constantly and a blob must download once per session, LRU if memory ever matters
const blobUrlCache = new Map<string, string>()

function pickThumbnail(thumbs: AssetThumbnail[]): AssetThumbnail | undefined {
  for (const size of THUMB_SIZES) {
    const match = thumbs.find((t) => t.size === size)
    if (match) return match
  }
  return thumbs[0]
}

export function AssetThumb({ asset, className = '', onThumbPicked }: AssetThumbProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const localThumb = useThumbStore((s) => s.urls[asset.fileId])
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (timer) continue
            timer = setTimeout(() => {
              setVisible(true)
              io.unobserve(entry.target)
            }, LOAD_DELAY_MS)
          } else if (timer) {
            clearTimeout(timer)
            timer = undefined
          }
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      clearTimeout(timer)
      io.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const controller = new AbortController()

    if (asset.kind !== 'photo' && asset.kind !== 'video') return

    const thumb = pickThumbnail(asset.thumbnails ?? [])
    if (!thumb) return

    onThumbPicked?.(thumb)
    const cachedUrl = blobUrlCache.get(thumb.fileId)
    if (cachedUrl) {
      setObjectUrl(cachedUrl)
      return
    }

    downloadFile(thumb.fileId, controller.signal)
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        blobUrlCache.set(thumb.fileId, url)
        setObjectUrl(url)
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setError(true)
      })

    return () => {
      cancelled = true
      controller.abort()
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
