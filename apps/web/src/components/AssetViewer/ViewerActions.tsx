import { useState } from 'react'
import {
  FaHeart,
  FaRegHeart,
  FaDownload,
  FaShare,
  FaCheck,
  FaTrash,
  FaTrashCan,
  FaRotateLeft,
  FaFolderPlus,
  FaFolderMinus,
  FaArrowsRotate,
  FaFilm,
} from 'react-icons/fa6'
import { downloadFile } from '../../api/assets'
import { createShare, getShareUrl } from '../../api/shares'
import type { Asset } from '@photox/shared-types'

interface ViewerActionsProps {
  asset: Asset
  onTrash?: () => void
  onRestore?: () => void
  onDelete?: () => void
  onToggleFavorite?: () => void
  onAddToAlbum?: () => void
  onRemoveFromAlbum?: () => void
  onReprocessThumbnails?: () => void
  onReprocessVideo?: () => void
}

export function ViewerActions({
  asset,
  onTrash,
  onRestore,
  onDelete,
  onToggleFavorite,
  onAddToAlbum,
  onRemoveFromAlbum,
  onReprocessThumbnails,
  onReprocessVideo,
}: ViewerActionsProps) {
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

  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  const handleShare = async () => {
    setShareLoading(true)
    try {
      const share = await createShare({ assetId: asset.id })
      const url = getShareUrl(share.token)
      await navigator.clipboard.writeText(url)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {
      /* ignore */
    } finally {
      setShareLoading(false)
    }
  }

  return (
    <>
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
            onClick={() => void handleShare()}
            className="p-2 text-white/80 hover:text-white transition-colors"
            title="Share"
            disabled={shareLoading}
          >
            {shareCopied ? (
              <FaCheck className="text-base text-green-400" />
            ) : (
              <FaShare className="text-base" />
            )}
          </button>
          {onReprocessThumbnails && (
            <button
              onClick={onReprocessThumbnails}
              className="p-2 text-white/80 hover:text-white transition-colors"
              title="Reprocess thumbnails"
              aria-label="Reprocess thumbnails"
            >
              <FaArrowsRotate className="text-base" />
            </button>
          )}
          {onReprocessVideo && (
            <button
              onClick={onReprocessVideo}
              className="p-2 text-white/80 hover:text-white transition-colors"
              title="Reprocess video"
              aria-label="Reprocess video"
            >
              <FaFilm className="text-base" />
            </button>
          )}
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
      {onDelete && (
        <button
          onClick={onDelete}
          className="p-2 text-red-400 hover:text-red-300 transition-colors"
          title="Permanently delete"
          aria-label="Permanently delete"
        >
          <FaTrashCan className="text-base" />
        </button>
      )}
    </>
  )
}
