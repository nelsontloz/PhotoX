import { useEffect, useRef, useState } from 'react'
import { FaChevronLeft, FaChevronRight, FaImage, FaSpinner, FaXmark } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { useAuthStore } from '../../store/auth-store'
import {
  downloadFile,
  getAsset,
  getHlsPlaylistUrl,
  getVideoStreamUrl,
  listThumbnails,
} from '../../api/assets'
import { VideoPlayer } from '../VideoPlayer'
import { ViewerTopBar } from './ViewerTopBar'
import { AssetMetadataPanel } from './sections/AssetMetadataPanel'
import { DescriptionSection } from './sections/DescriptionSection'
import { LocationSection } from './sections/LocationSection'

interface AssetViewerProps {
  asset: Asset
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev: boolean
  hasNext: boolean
  onTrash?: () => void
  onRestore?: () => void
}

const TRANSCODE_POLL_MS = 5_000

async function loadThumbBlob(id: string, preferSize: 'xl' | 'lg'): Promise<string | null> {
  const thumbs = await listThumbnails(id)
  const picked = thumbs.find((t) => t.size === preferSize) ?? thumbs[0]
  if (!picked) return null
  const blob = await downloadFile(picked.fileId)
  return URL.createObjectURL(blob)
}

export function AssetViewer({
  asset,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onTrash,
  onRestore,
}: AssetViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [currentAsset, setCurrentAsset] = useState<Asset>(asset)
  const urlRef = useRef<string | null>(null)
  const posterRef = useRef<string | null>(null)
  const userId = useAuthStore((s) => s.user?.id)

  useEffect(() => {
    setCurrentAsset(asset)
  }, [asset])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setImageUrl(null)
    setVideoPosterUrl(null)

    if (currentAsset.kind === 'photo') {
      loadThumbBlob(currentAsset.id, 'xl')
        .then((url) => {
          if (cancelled || !url) {
            if (!cancelled) setLoading(false)
            return
          }
          urlRef.current = url
          setImageUrl(url)
        })
        .catch(() => {
          if (!cancelled) setLoading(false)
        })
    } else {
      loadThumbBlob(currentAsset.id, 'lg')
        .then((url) => {
          if (cancelled || !url) {
            if (!cancelled) setLoading(false)
            return
          }
          posterRef.current = url
          setVideoPosterUrl(url)
        })
        .catch(() => {
          if (!cancelled) setLoading(false)
        })
    }

    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      if (posterRef.current) {
        URL.revokeObjectURL(posterRef.current)
        posterRef.current = null
      }
    }
  }, [currentAsset.id, currentAsset.kind])

  useEffect(() => {
    if (currentAsset.kind !== 'video') return
    if (currentAsset.transcodeStatus !== 'pending') return

    let cancelled = false
    const interval = setInterval(() => {
      void getAsset(currentAsset.id)
        .then((next) => {
          if (cancelled) return
          setCurrentAsset(next)
          if (next.transcodeStatus !== 'pending') {
            clearInterval(interval)
          }
        })
        .catch(() => {
          /* ignore transient errors; the next tick will retry */
        })
    }, TRANSCODE_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [currentAsset.id, currentAsset.kind, currentAsset.transcodeStatus])

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

  const isVideo = currentAsset.kind === 'video'
  const videoSrc = isVideo && userId ? getVideoStreamUrl(currentAsset.id, userId) : null
  const hlsSrc = isVideo ? getHlsPlaylistUrl(currentAsset.id) : null
  const transcodeStatus = isVideo ? currentAsset.transcodeStatus : undefined

  return (
    <div className="fixed inset-0 z-50 flex overflow-hidden bg-black">
      {imageUrl && !isVideo && (
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
          asset={currentAsset}
          infoOpen={infoOpen}
          onToggleInfo={() => {
            setInfoOpen((v) => !v)
          }}
          onClose={onClose}
          onTrash={onTrash}
          onRestore={onRestore}
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
          {isVideo && videoSrc && hlsSrc ? (
            <VideoPlayer
              src={videoSrc}
              hlsSrc={hlsSrc}
              poster={videoPosterUrl ?? undefined}
              title={currentAsset.title ?? currentAsset.originalName ?? undefined}
              transcodeStatus={transcodeStatus}
              className="relative max-h-full max-w-full"
            />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={currentAsset.originalName ?? currentAsset.title ?? 'Photo'}
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
            <AssetMetadataPanel asset={currentAsset} />
            <DescriptionSection asset={currentAsset} />
            <LocationSection asset={currentAsset} />
          </div>
        </aside>
      )}
    </div>
  )
}
