import { useState } from 'react'
import { FaFaceSmile } from 'react-icons/fa6'
import { Skeleton } from './Skeleton'

interface FaceThumbProps {
  faceId: string | null
  alt: string
  className?: string
}

export function FaceThumb({ faceId, alt, className = '' }: FaceThumbProps) {
  const [loadedFaceId, setLoadedFaceId] = useState<string | null>(null)
  const [failedFaceId, setFailedFaceId] = useState<string | null>(null)

  if (!faceId || failedFaceId === faceId) {
    return (
      <div className="flex flex-col items-center gap-1">
        <FaFaceSmile className="text-3xl text-slate-500" />
      </div>
    )
  }

  const src = `/api/v1/faces/${encodeURIComponent(faceId)}/thumb`

  if (loadedFaceId !== faceId) {
    return (
      <>
        {/* Eager (no loading="lazy") and aria-hidden: this load is what the Skeleton below stands in
            for, and a display:none lazy image might never be fetched. */}
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="hidden"
          decoding="async"
          onLoad={() => setLoadedFaceId(faceId)}
          onError={() => setFailedFaceId(faceId)}
        />
        <Skeleton className={`w-full h-full ${className}`} />
      </>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className || 'w-full h-full object-cover'}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  )
}
