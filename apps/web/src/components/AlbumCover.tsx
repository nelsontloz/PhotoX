import { useEffect, useRef, useState } from 'react'
import { FaPhotoFilm } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { listAlbumAssets } from '../api/albums'
import { AssetThumb } from './AssetThumb'

export function AlbumCover({
  albumId,
  className = '',
  emptyIconClassName = 'text-2xl text-slate-700',
}: {
  albumId: string
  className?: string
  emptyIconClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [cover, setCover] = useState<Asset | null>(null)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        if (started.current) return
        started.current = true
        listAlbumAssets(albumId, { limit: 1 })
          .then((res) => setCover(res.items[0] ?? null))
          .catch(() => setCover(null))
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [albumId])

  if (cover) {
    return (
      <div ref={ref} className={`absolute inset-0 ${className}`}>
        <AssetThumb asset={cover} />
      </div>
    )
  }
  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center">
      <FaPhotoFilm className={emptyIconClassName} />
    </div>
  )
}
