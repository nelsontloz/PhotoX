import { FaArrowLeft, FaCircleInfo, FaObjectGroup } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { formatBytes } from '../../lib/format'
import { formatDate } from '../../lib/dateFormat'
import { ViewerActions } from './ViewerActions'

interface ViewerTopBarProps {
  asset: Asset
  infoOpen: boolean
  onToggleInfo: () => void
  onClose: () => void
  detectionsOn?: boolean
  onToggleDetections?: () => void
  onTrash?: () => void
  onRestore?: () => void
  onDelete?: () => void
  onToggleFavorite?: () => void
  onAddToAlbum?: () => void
  onRemoveFromAlbum?: () => void
  onReprocessThumbnails?: () => void
  onReprocessVideo?: () => void
}

export function ViewerTopBar({
  asset,
  infoOpen,
  onToggleInfo,
  onClose,
  detectionsOn,
  onToggleDetections,
  onTrash,
  onRestore,
  onDelete,
  onToggleFavorite,
  onAddToAlbum,
  onRemoveFromAlbum,
  onReprocessThumbnails,
  onReprocessVideo,
}: ViewerTopBarProps) {
  const title = asset.originalName ?? asset.title ?? 'Untitled'
  const dateStr = asset.takenAt ?? asset.uploadedAt
  const sizeStr = asset.sizeBytes ? ` · ${formatBytes(asset.sizeBytes)}` : ''

  return (
    <div className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between gap-2 px-4 sm:px-6 z-20 bg-gradient-to-b from-black/40 to-transparent">
      <div className="flex flex-1 min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onClose}
          className="p-2 text-white/80 hover:text-white transition-colors shrink-0"
        >
          <FaArrowLeft className="text-lg" />
        </button>
        <div className="min-w-0">
          <h3 className="text-white text-sm font-medium truncate">{title}</h3>
          <p className="text-white/60 text-xs truncate">
            Shot on {formatDate(dateStr)}
            {sizeStr}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden items-center gap-2 sm:flex">
          <ViewerActions
            asset={asset}
            onTrash={onTrash}
            onRestore={onRestore}
            onDelete={onDelete}
            onToggleFavorite={onToggleFavorite}
            onAddToAlbum={onAddToAlbum}
            onRemoveFromAlbum={onRemoveFromAlbum}
            onReprocessThumbnails={onReprocessThumbnails}
            onReprocessVideo={onReprocessVideo}
          />
          <div className="w-px h-4 bg-white/20 mx-2" />
        </div>
        {onToggleDetections && (
          <button
            onClick={onToggleDetections}
            className="p-2 text-white/80 hover:text-white transition-colors"
            title={detectionsOn ? 'Hide detected objects' : 'Show detected objects'}
            aria-pressed={detectionsOn}
          >
            <FaObjectGroup className={`text-base ${detectionsOn ? 'text-primary' : ''}`} />
          </button>
        )}
        <button
          onClick={onToggleInfo}
          className="p-2 text-white/80 hover:text-white transition-colors"
          title="Toggle Info"
        >
          <FaCircleInfo className={`text-base ${infoOpen ? 'text-primary' : ''}`} />
        </button>
      </div>
    </div>
  )
}
