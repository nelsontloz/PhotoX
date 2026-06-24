import { useEffect, useRef, useState } from 'react'
import { FaChevronLeft, FaChevronRight, FaImage, FaSpinner, FaXmark } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { downloadFile, listThumbnails } from '../../api/assets'
import { ViewerTopBar } from './ViewerTopBar'
import { DescriptionSection } from './sections/DescriptionSection'
import { LocationSection } from './sections/LocationSection'

interface AssetViewerProps {
  asset: Asset
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev: boolean
  hasNext: boolean
}

export function AssetViewer({
  asset,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: AssetViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setImageUrl(null)

    if (asset.kind !== 'photo') {
      setLoading(false)
      return
    }

    listThumbnails(asset.id)
      .then((thumbs) => {
        const xl = thumbs.find((t) => t.size === 'xl')
        if (!xl) throw new Error('No preview available')
        return downloadFile(xl.fileId)
      })
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        setImageUrl(url)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [asset.id, asset.kind])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasPrev && onPrev) onPrev()
      else if (e.key === 'ArrowRight' && hasNext && onNext) onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext, hasPrev, hasNext])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex overflow-hidden bg-black">
      {imageUrl && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            src={imageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60"
          />
          <div className="absolute inset-0 bg-black/50" />
        </div>
      )}
      <div className="relative flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <ViewerTopBar
          asset={asset}
          infoOpen={infoOpen}
          onToggleInfo={() => {
            setInfoOpen((v) => !v)
          }}
          onClose={onClose}
        />
        <div className="flex-1 flex items-center justify-center p-8 relative min-h-0">
          {hasPrev && onPrev && (
            <button
              onClick={onPrev}
              className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-all backdrop-blur-sm z-10"
              aria-label="Previous photo"
            >
              <FaChevronLeft className="text-2xl" />
            </button>
          )}
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={asset.originalName ?? asset.title ?? 'Photo'}
              className="relative max-h-full max-w-full object-contain shadow-2xl select-none"
            />
          ) : loading ? (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <FaSpinner className="text-4xl text-primary animate-spin" />
              <p className="text-sm">Loading preview…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <FaImage className="text-5xl opacity-30" />
              <p className="text-sm">No preview available</p>
            </div>
          )}
          {hasNext && onNext && (
            <button
              onClick={onNext}
              className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-all backdrop-blur-sm z-10"
              aria-label="Next photo"
            >
              <FaChevronRight className="text-2xl" />
            </button>
          )}
        </div>
      </div>
      {infoOpen && (
        <aside className="relative w-80 h-full bg-card-dark border-l border-border-dark flex flex-col shrink-0">
          <div className="h-16 flex items-center px-6 border-b border-border-dark shrink-0">
            <h2 className="text-white font-semibold text-lg">Details</h2>
            <button
              onClick={() => {
                setInfoOpen(false)
              }}
              className="ml-auto p-1.5 text-slate-400 hover:text-white transition-colors"
              aria-label="Close details panel"
            >
              <FaXmark className="text-[20px]" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            <DescriptionSection asset={asset} />
            <LocationSection asset={asset} />
          </div>
        </aside>
      )}
    </div>
  )
}
