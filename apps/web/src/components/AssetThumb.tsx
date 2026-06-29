import { useEffect, useRef, useState } from 'react'
import { FaSpinner, FaTriangleExclamation } from 'react-icons/fa6'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { listThumbnails, downloadFile } from '../api/assets'
import { useThumbStore } from '../store/thumb-store'
import { Skeleton } from './Skeleton'

interface AssetThumbProps {
  asset: Asset
  className?: string
  onThumbPicked?: (thumb: AssetThumbnail) => void
}

const THUMB_SIZES = ['md', 'lg', 'sm']

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
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false

    if (asset.kind !== 'photo' && asset.kind !== 'video') return

    listThumbnails(asset.id)
      .then((thumbs) => {
        if (cancelled || thumbs.length === 0) return
        const thumb = pickThumbnail(thumbs)
        if (!thumb) return
        onThumbPicked?.(thumb)
        return downloadFile(thumb.fileId)
      })
      .then((blob) => {
        if (cancelled || !blob) return
        const url = URL.createObjectURL(blob)
        setObjectUrl(url)
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
