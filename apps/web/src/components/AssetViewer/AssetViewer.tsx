import { useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { useAuthStore } from '../../store/auth-store'
import { getAsset, getVideoStreamUrl } from '../../api/assets'
import { ViewerTopBar } from './ViewerTopBar'
import { useAssetMedia } from './useAssetMedia'
import { useBodyScrollLock } from './useBodyScrollLock'
import { useViewerKeyboard } from './useViewerKeyboard'
import { ViewerMedia } from './ViewerMedia'
import { ViewerInfoPanel } from './ViewerInfoPanel'

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
  const [currentAsset, setCurrentAsset] = useState<Asset>(asset)
  const [infoOpen, setInfoOpen] = useState(false)
  const userId = useAuthStore((s) => s.user?.id)

  useEffect(() => {
    setCurrentAsset(asset)
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
  const { imageUrl, videoPosterUrl, loading } = useAssetMedia(currentAsset)
  useViewerKeyboard({ onClose, onPrev, onNext, hasPrev, hasNext })
  useBodyScrollLock()

  const isVideo = currentAsset.kind === 'video'
  const primaryVideoSrc =
    isVideo && userId
      ? getVideoStreamUrl(currentAsset.transcodeFileId ?? currentAsset.fileId, userId)
      : null
  const videoFallbackSrc =
    isVideo && userId && currentAsset.transcodeFileId
      ? getVideoStreamUrl(currentAsset.fileId, userId)
      : undefined
  const imageAlt = currentAsset.originalName ?? currentAsset.title ?? 'Photo'
  const videoTitle = currentAsset.title ?? currentAsset.originalName ?? undefined

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
        <ViewerMedia
          isVideo={isVideo}
          videoSrc={primaryVideoSrc}
          videoFallbackSrc={videoFallbackSrc}
          videoPoster={videoPosterUrl ?? undefined}
          videoTitle={videoTitle}
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          loading={loading}
          hasPrev={hasPrev}
          hasNext={hasNext}
          infoOpen={infoOpen}
          asset={currentAsset}
          onPrev={onPrev}
          onNext={onNext}
        />
      </div>
      {infoOpen && (
        <ViewerInfoPanel
          asset={currentAsset}
          onClose={() => {
            setInfoOpen(false)
          }}
        />
      )}
    </div>
  )
}
