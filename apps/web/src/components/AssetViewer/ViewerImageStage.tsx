import { FaChevronLeft, FaChevronRight } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'

interface ViewerImageStageProps {
  asset: Asset
  objectUrl: string | null
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
}

export function ViewerImageStage({
  asset,
  objectUrl,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: ViewerImageStageProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-8 relative">
      {hasPrev && (
        <button
          onClick={onPrev}
          className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 text-white transition-all backdrop-blur-sm group z-10"
        >
          <FaChevronLeft className="text-2xl group-active:scale-90 transition-transform" />
        </button>
      )}

      {objectUrl ? (
        asset.kind === 'video' ? (
          <video
            controls
            src={objectUrl}
            className="max-h-full max-w-full object-contain shadow-2xl select-none"
          />
        ) : (
          <img
            src={objectUrl}
            alt={asset.originalName ?? asset.title ?? 'Photo'}
            className="max-h-full max-w-full object-contain shadow-2xl select-none"
          />
        )
      ) : (
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      )}

      {hasNext && (
        <button
          onClick={onNext}
          className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 text-white transition-all backdrop-blur-sm group z-10"
        >
          <FaChevronRight className="text-2xl group-active:scale-90 transition-transform" />
        </button>
      )}
    </div>
  )
}
