import { useEffect, useState } from 'react'
import { FaSpinner, FaTriangleExclamation } from 'react-icons/fa6'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { listThumbnails, downloadFile } from '../api/assets'
import { useThumbStore } from '../store/thumb-store'
import { Skeleton } from './Skeleton'

interface AssetThumbProps {
  asset: Asset
  className?: string
}

const THUMB_SIZES = ['md', 'lg', 'sm']

function pickThumbnail(thumbs: AssetThumbnail[]): AssetThumbnail | undefined {
  for (const size of THUMB_SIZES) {
    const match = thumbs.find((t) => t.size === size)
    if (match) return match
  }
  return thumbs[0]
}

export function AssetThumb({ asset, className = '' }: AssetThumbProps) {
  const localThumb = useThumbStore((s) => s.urls[asset.fileId])
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (asset.kind !== 'photo' && asset.kind !== 'video') return

    listThumbnails(asset.id)
      .then((thumbs) => {
        if (cancelled || thumbs.length === 0) return
        const thumb = pickThumbnail(thumbs)
        if (!thumb) return
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
  }, [asset.id, asset.kind])

  const src = localThumb ?? objectUrl

  const isVideo = asset.kind === 'video'
  const transcodeStatus = isVideo ? asset.transcodeStatus : null

  if (error && !src) {
    return (
      <div className={`w-full h-full bg-slate-800 flex items-center justify-center ${className}`}>
        <span className="text-xs text-slate-500">No preview</span>
      </div>
    )
  }

  if (!src) {
    return <Skeleton className={`w-full h-full ${className}`} />
  }

  const altText = isVideo
    ? (asset.originalName ?? asset.title ?? 'Video')
    : (asset.originalName ?? asset.title ?? 'Photo')

  return (
    <div className={`relative w-full h-full ${className}`}>
      <img
        src={src}
        alt={altText}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
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
        <div className="absolute top-2 right-2 pointer-events-none" aria-label="Transcode failed">
          <div className="bg-amber-500/90 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center">
            <FaTriangleExclamation className="text-white text-[12px]" />
          </div>
        </div>
      )}
    </div>
  )
}
