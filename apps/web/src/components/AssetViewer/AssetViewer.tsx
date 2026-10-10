import { useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { getAsset, getFileStreamUrl, reprocessThumbnails, reprocessVideo } from '../../api/assets'
import { ViewerTopBar } from './ViewerTopBar'
import { ViewerActions } from './ViewerActions'
import { useAssetMedia } from './useAssetMedia'
import { useDetections } from './useDetections'
import { useAssetDuplicates, useSimilarAssets } from './useRelatedAssets'
import { useViewerKeyboard } from './useViewerKeyboard'
import { ViewerMedia } from './ViewerMedia'
import { ViewerInfoPanel } from './ViewerInfoPanel'
import { ViewerRelatedTray } from './ViewerRelatedTray'

interface AssetViewerProps {
  asset: Asset
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev: boolean
  hasNext: boolean
  onTrash?: () => void
  onRestore?: () => void
  onDelete?: () => void
  onToggleFavorite?: (nextValue: boolean) => void
  onAddToAlbum?: () => void
  onRemoveFromAlbum?: () => void
  siblingAssets?: Asset[]
  onSelectSibling?: (asset: Asset) => void
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
  onDelete,
  onToggleFavorite,
  onAddToAlbum,
  onRemoveFromAlbum,
  siblingAssets,
  onSelectSibling,
}: AssetViewerProps) {
  const [currentAsset, setCurrentAsset] = useState<Asset>(asset)
  const [infoOpen, setInfoOpen] = useState(false)
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null)
  const [favOverride, setFavOverride] = useState<boolean | null>(null)
  const [reprocessLoading, setReprocessLoading] = useState(false)
  const [detectionsOn, setDetectionsOn] = useState(false)

  useEffect(() => {
    setCurrentAsset(asset)
    setFavOverride(null)
    setHoveredFaceId(null)
    let cancelled = false
    void getAsset(asset.id)
      .then((fresh) => {
        if (!cancelled) setCurrentAsset(fresh)
      })
      .catch(() => {
        // ponytail: list entry is good enough on refetch failure (faces missing is the only diff)
      })
    return () => {
      cancelled = true
    }
  }, [asset])
  const { imageUrl, videoPosterUrl, placeholderUrl, loading } = useAssetMedia(currentAsset)
  useViewerKeyboard({ onClose, onPrev, onNext, hasPrev, hasNext })

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const isVideo = currentAsset.kind === 'video'
  const canShowDetections = !isVideo && currentAsset.width != null && currentAsset.height != null
  const { status: detectionStatus, detections } = useDetections(
    currentAsset.id,
    detectionsOn && canShowDetections,
  )
  // related sections skip trashed assets: suggestions for something already in the trash lead
  // into viewer actions (restore/delete) that don't apply to live results
  const relatedEnabled = !currentAsset.isTrashed
  const similar = useSimilarAssets(currentAsset.id, relatedEnabled)
  const duplicates = useAssetDuplicates(currentAsset.id, relatedEnabled)
  const primaryVideoSrc = isVideo
    ? getFileStreamUrl(currentAsset.transcodeFileId ?? currentAsset.fileId)
    : null
  const videoFallbackSrc =
    isVideo && currentAsset.transcodeFileId ? getFileStreamUrl(currentAsset.fileId) : undefined
  // video.js picks a source via canPlayType(type); the transcode is always AV1-in-webm.
  const videoType = isVideo
    ? currentAsset.transcodeFileId
      ? 'video/webm'
      : (currentAsset.mimeType ?? undefined)
    : undefined
  const videoFallbackType = isVideo ? (currentAsset.mimeType ?? undefined) : undefined
  const imageAlt = currentAsset.originalName ?? currentAsset.title ?? 'Photo'
  const videoTitle = currentAsset.title ?? currentAsset.originalName ?? undefined
  const displayAsset =
    favOverride !== null ? { ...currentAsset, favorite: favOverride } : currentAsset

  const handleToggleFavorite = () => {
    const next = !(favOverride ?? currentAsset.favorite)
    setFavOverride(next)
    onToggleFavorite?.(next)
  }

  const handleReprocessThumbnails = async () => {
    setReprocessLoading(true)
    try {
      await reprocessThumbnails(currentAsset.id)
    } catch {
      // ignore
    } finally {
      setReprocessLoading(false)
    }
  }

  const handleReprocessVideo = async () => {
    setReprocessLoading(true)
    try {
      await reprocessVideo(currentAsset.id)
    } catch {
      // ignore
    } finally {
      setReprocessLoading(false)
    }
  }

  const reprocessThumbnailsAction = !reprocessLoading
    ? () => {
        void handleReprocessThumbnails()
      }
    : undefined
  const reprocessVideoAction =
    currentAsset.kind === 'video' && !reprocessLoading
      ? () => {
          void handleReprocessVideo()
        }
      : undefined

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
          asset={displayAsset}
          infoOpen={infoOpen}
          onToggleInfo={() => {
            setInfoOpen((v) => !v)
            setHoveredFaceId(null)
          }}
          onClose={onClose}
          detectionsOn={detectionsOn}
          onToggleDetections={
            canShowDetections ? () => setDetectionsOn((value) => !value) : undefined
          }
          onTrash={onTrash}
          onRestore={onRestore}
          onDelete={onDelete}
          onToggleFavorite={handleToggleFavorite}
          onAddToAlbum={onAddToAlbum}
          onRemoveFromAlbum={onRemoveFromAlbum}
          onReprocessThumbnails={reprocessThumbnailsAction}
          onReprocessVideo={reprocessVideoAction}
        />
        <ViewerMedia
          isVideo={isVideo}
          videoSrc={primaryVideoSrc}
          videoFallbackSrc={videoFallbackSrc}
          videoType={videoType}
          videoFallbackType={videoFallbackType}
          videoPoster={videoPosterUrl ?? placeholderUrl ?? undefined}
          videoTitle={videoTitle}
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          loading={loading}
          placeholderUrl={placeholderUrl}
          hasPrev={hasPrev}
          hasNext={hasNext}
          infoOpen={infoOpen}
          asset={currentAsset}
          highlightedFaceId={hoveredFaceId}
          detectionsOn={detectionsOn}
          detectionStatus={detectionStatus}
          detections={detections}
          onPrev={onPrev}
          onNext={onNext}
          siblingAssets={siblingAssets}
          onSelectSibling={onSelectSibling}
        />
        <ViewerRelatedTray
          similar={similar}
          duplicates={duplicates}
          onOpenAsset={onSelectSibling}
        />
        {/* Mobile only: action row directly under the header (h-16), centered.
            No background: the header gradient already ends transparent at its bottom
            edge, so nothing here can form a seam. The bottom band is strip-only. */}
        <div className="absolute top-16 left-0 right-0 z-20 sm:hidden">
          <div className="flex flex-wrap items-center justify-center gap-1 px-4 py-2">
            <ViewerActions
              asset={displayAsset}
              onTrash={onTrash}
              onRestore={onRestore}
              onDelete={onDelete}
              onToggleFavorite={handleToggleFavorite}
              onAddToAlbum={onAddToAlbum}
              onRemoveFromAlbum={onRemoveFromAlbum}
              onReprocessThumbnails={reprocessThumbnailsAction}
              onReprocessVideo={reprocessVideoAction}
            />
          </div>
        </div>
      </div>
      {infoOpen && (
        <ViewerInfoPanel
          asset={currentAsset}
          onFaceHover={setHoveredFaceId}
          onClose={() => {
            setInfoOpen(false)
            setHoveredFaceId(null)
          }}
        />
      )}
    </div>
  )
}
