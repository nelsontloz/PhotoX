import { FaChevronLeft, FaChevronRight, FaImage, FaSpinner } from 'react-icons/fa6'
import type { Asset, AssetDetectionDto, FaceDto } from '@photox/shared-types'
import { VideoPlayer } from '../VideoPlayer'
import { FaceOverlay } from './FaceOverlay'
import { DetectionOverlay } from './DetectionOverlay'
import { summarizeDetections } from './detectionView'
import { ViewerThumbnailStrip } from './ViewerThumbnailStrip'
import { ZoomableImage } from './ZoomableImage'

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
  highlightedFaceId?: string | null
  detectionsOn?: boolean
  detectionStatus?: 'idle' | 'loading' | 'ready'
  detections?: AssetDetectionDto[]
  onPrev?: () => void
  onNext?: () => void
  siblingAssets?: Asset[]
  onSelectSibling?: (asset: Asset) => void
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
  highlightedFaceId,
  detectionsOn = false,
  detectionStatus = 'idle',
  detections = [],
  onPrev,
  onNext,
  siblingAssets,
  onSelectSibling,
}: ViewerMediaProps) {
  const faces: FaceDto[] = asset.faces ?? []
  const dims =
    asset.width != null && asset.height != null ? { w: asset.width, h: asset.height } : null
  const showOverlay = infoOpen && !isVideo && imageUrl != null && dims != null && faces.length > 0
  const showDetections = detectionsOn && !isVideo && imageUrl != null && dims != null

  return (
    <div className="flex-1 flex items-center justify-center p-8 pt-28 pb-28 sm:pt-20 sm:pb-24 relative min-h-0">
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
          key={asset.id}
          src={videoSrc}
          fallbackSrc={videoFallbackSrc}
          poster={videoPoster}
          title={videoTitle}
          className="relative max-h-full max-w-full"
        />
      ) : imageUrl ? (
        dims ? (
          <ZoomableImage
            key={asset.id}
            src={imageUrl}
            alt={imageAlt}
            width={dims.w}
            height={dims.h}
          >
            {showOverlay && (
              <FaceOverlay
                faces={faces}
                imageWidth={dims.w}
                imageHeight={dims.h}
                highlightedFaceId={highlightedFaceId}
              />
            )}
            {showDetections && (
              <DetectionOverlay detections={detections} imageWidth={dims.w} imageHeight={dims.h} />
            )}
          </ZoomableImage>
        ) : (
          <img
            src={imageUrl}
            alt={imageAlt}
            decoding="async"
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
      {showDetections && (
        <div className="absolute bottom-32 sm:bottom-28 left-4 sm:left-6 z-10 flex items-center gap-2 rounded-full bg-black/40 backdrop-blur-sm px-3 py-1.5 text-xs text-white/80">
          {detectionStatus === 'loading' ? (
            <>
              <FaSpinner className="animate-spin" />
              <span>Loading objects…</span>
            </>
          ) : (
            <span className="tabular-nums">{summarizeDetections(detections)}</span>
          )}
        </div>
      )}
      {siblingAssets && onSelectSibling && (
        <ViewerThumbnailStrip
          assets={siblingAssets}
          currentAssetId={asset.id}
          onSelect={onSelectSibling}
        />
      )}
    </div>
  )
}
