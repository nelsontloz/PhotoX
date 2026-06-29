import {
  FaArrowLeft,
  FaHeart,
  FaRegHeart,
  FaDownload,
  FaShare,
  FaPen,
  FaCircleInfo,
  FaTrash,
  FaRotateLeft,
  FaFolderPlus,
  FaFolderMinus,
} from 'react-icons/fa6'
import { downloadFile } from '../../api/assets'
import type { Asset } from '@photox/shared-types'
import { formatBytes } from '../../lib/format'

interface ViewerTopBarProps {
  asset: Asset
  infoOpen: boolean
  onToggleInfo: () => void
  onClose: () => void
  onTrash?: () => void
  onRestore?: () => void
  onToggleFavorite?: () => void
  onAddToAlbum?: () => void
  onRemoveFromAlbum?: () => void
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ViewerTopBar({
  asset,
  infoOpen,
  onToggleInfo,
  onClose,
  onTrash,
  onRestore,
  onToggleFavorite,
  onAddToAlbum,
  onRemoveFromAlbum,
}: ViewerTopBarProps) {
  const title = asset.originalName ?? asset.title ?? 'Untitled'
  const dateStr = asset.takenAt ?? asset.uploadedAt
  const sizeStr = asset.sizeBytes ? ` · ${formatBytes(asset.sizeBytes)}` : ''

  const handleDownload = async () => {
    try {
      const blob = await downloadFile(asset.fileId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = asset.originalName ?? 'download'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }

  const handleShare = () => {
    void navigator.clipboard.writeText(window.location.href)
  }

  return (
    <div className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-6 z-20 bg-gradient-to-b from-black/40 to-transparent">
      <div className="flex items-center gap-4">
        <button onClick={onClose} className="p-2 text-white/80 hover:text-white transition-colors">
          <FaArrowLeft className="text-lg" />
        </button>
        <div>
          <h3 className="text-white text-sm font-medium">{title}</h3>
          <p className="text-white/60 text-xs">
            Shot on {formatDate(dateStr)}
            {sizeStr}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleFavorite}
          className="p-2 text-white/80 hover:text-white transition-colors"
          title="Favorite"
        >
          {asset.favorite ? (
            <FaHeart className="text-base fill-red-500 text-red-500" />
          ) : (
            <FaRegHeart className="text-base" />
          )}
        </button>
        <button
          onClick={() => void handleDownload()}
          className="p-2 text-white/80 hover:text-white transition-colors"
          title="Download"
        >
          <FaDownload className="text-base" />
        </button>
        {!asset.isTrashed && (
          <>
            <button
              onClick={() => handleShare()}
              className="p-2 text-white/80 hover:text-white transition-colors"
              title="Share"
            >
              <FaShare className="text-base" />
            </button>
            <button className="p-2 text-white/80 hover:text-white transition-colors" title="Edit">
              <FaPen className="text-base" />
            </button>
            {onAddToAlbum && (
              <button
                onClick={onAddToAlbum}
                className="p-2 text-white/80 hover:text-white transition-colors"
                title="Add to album"
                aria-label="Add to album"
              >
                <FaFolderPlus className="text-base" />
              </button>
            )}
            {onRemoveFromAlbum && (
              <button
                onClick={onRemoveFromAlbum}
                className="p-2 text-white/80 hover:text-white transition-colors"
                title="Remove from this album"
                aria-label="Remove from this album"
              >
                <FaFolderMinus className="text-base" />
              </button>
            )}
          </>
        )}
        {onTrash && (
          <button
            onClick={onTrash}
            className="p-2 text-red-400 hover:text-red-300 transition-colors"
            title="Move to trash"
            aria-label="Move to trash"
          >
            <FaTrash className="text-base" />
          </button>
        )}
        {onRestore && (
          <button
            onClick={onRestore}
            className="p-2 text-white/80 hover:text-white transition-colors"
            title="Restore from trash"
            aria-label="Restore from trash"
          >
            <FaRotateLeft className="text-base" />
          </button>
        )}
        <div className="w-px h-4 bg-white/20 mx-2" />
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
