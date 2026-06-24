import { FaArrowLeft, FaHeart, FaDownload, FaShare, FaPen, FaCircleInfo } from 'react-icons/fa6'
import { downloadFile } from '../../api/assets'
import type { Asset } from '@photox/shared-types'

interface ViewerTopBarProps {
  asset: Asset
  infoOpen: boolean
  onToggleInfo: () => void
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ViewerTopBar({ asset, infoOpen, onToggleInfo, onClose }: ViewerTopBarProps) {
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
        <button className="p-2 text-white/80 hover:text-white transition-colors" title="Favorite">
          <FaHeart className={`text-base ${asset.favorite ? 'fill-red-500 text-red-500' : ''}`} />
        </button>
        <button
          onClick={() => void handleDownload()}
          className="p-2 text-white/80 hover:text-white transition-colors"
          title="Download"
        >
          <FaDownload className="text-base" />
        </button>
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
