import { FaChevronLeft, FaChevronRight, FaImage, FaSpinner } from 'react-icons/fa6'
import type { Asset, FaceDto } from '@photox/shared-types'
import { VideoPlayer } from '../VideoPlayer'
import { FaceOverlay } from './FaceOverlay'

interface ViewerMediaProps {
  isVideo: boolean
  videoSrc: string | null
  videoFallbackSrc: string | undefined
  videoPoster: string | undefined
  videoTitle: string | undefined
  imageUrl: string | null
  imageAlt: string
  loading: boolean
  hasPrev: boolean
  hasNext: boolean
  infoOpen: boolean
  asset: Asset
  onPrev?: () => void
  onNext?: () => void
}

export function ViewerMedia({
  isVideo,
  videoSrc,
  videoFallbackSrc,
  videoPoster,
  videoTitle,
  imageUrl,
  imageAlt,
  loading,
  hasPrev,
  hasNext,
  infoOpen,
  asset,
  onPrev,
  onNext,
}: ViewerMediaProps) {
  const faces: FaceDto[] = asset.faces ?? []
  const dims =
    asset.width != null && asset.height != null ? { w: asset.width, h: asset.height } : null
  const showOverlay = infoOpen && !isVideo && imageUrl != null && dims != null && faces.length > 0

  return (
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
      {isVideo && videoSrc ? (
        <VideoPlayer
          src={videoSrc}
          fallbackSrc={videoFallbackSrc}
          poster={videoPoster}
          title={videoTitle}
          className="relative max-h-full max-w-full"
        />
      ) : imageUrl ? (
        dims ? (
          <div
            className="relative max-h-full max-w-full"
            style={{ aspectRatio: `${dims.w} / ${dims.h}` }}
          >
            <img
              src={imageUrl}
              alt={imageAlt}
              className="block w-full h-full object-contain shadow-2xl select-none"
            />
            {showOverlay && <FaceOverlay faces={faces} imageWidth={dims.w} imageHeight={dims.h} />}
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={imageAlt}
            className="relative max-h-full max-w-full object-contain shadow-2xl select-none"
          />
        )
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
  )
}
