import { useEffect, useState } from 'react'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { listThumbnails, downloadFile } from '../api/assets'
import { useThumbStore } from '../store/thumb-store'
import { Skeleton } from './Skeleton'

interface AssetThumbProps {
  asset: Asset
  className?: string
}

const THUMB_SIZES = ['sm', 'md', 'lg']

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

    if (asset.kind !== 'photo') return

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

  if (error && !src) {
    return (
      <div className={`w-full bg-slate-800 flex items-center justify-center ${className}`}>
        <span className="text-xs text-slate-500">No preview</span>
      </div>
    )
  }

  if (!src) {
    const aspect =
      asset.width && asset.height
        ? { aspectRatio: `${asset.width} / ${asset.height}` }
        : { paddingBottom: '75%' }

    return <Skeleton className={`w-full ${className}`} style={{ ...aspect, width: '100%' }} />
  }

  return (
    <img
      src={src}
      alt={asset.originalName ?? asset.title ?? 'Photo'}
      className={`w-full h-auto object-cover ${className}`}
      loading="lazy"
    />
  )
}
