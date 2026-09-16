import { useEffect, useState } from 'react'
import { FaFaceSmile } from 'react-icons/fa6'
import { downloadFaceThumb } from '../api/faces'
import { Skeleton } from './Skeleton'

interface FaceThumbProps {
  faceId: string | null
  alt: string
  className?: string
}

export function FaceThumb({ faceId, alt, className = '' }: FaceThumbProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!faceId) return
    let cancelled = false
    let url: string | null = null
    setObjectUrl(null)
    setError(false)
    const controller = new AbortController()
    downloadFaceThumb(faceId, undefined, controller.signal)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [faceId])

  if (!faceId || error) {
    return (
      <div className="flex flex-col items-center gap-1">
        <FaFaceSmile className="text-3xl text-slate-500" />
      </div>
    )
  }

  if (!objectUrl) {
    return <Skeleton className={`w-full h-full ${className}`} />
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className || 'w-full h-full object-cover'}
      loading="lazy"
      draggable={false}
    />
  )
}
