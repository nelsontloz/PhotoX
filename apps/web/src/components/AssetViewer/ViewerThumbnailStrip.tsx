import type { Asset } from '@photox/shared-types'
import { AssetThumb } from '../AssetThumb'

interface ViewerThumbnailStripProps {
  assets: Asset[]
  currentAssetId: string
  onSelect: (asset: Asset) => void
}

export function ViewerThumbnailStrip({
  assets,
  currentAssetId,
  onSelect,
}: ViewerThumbnailStripProps) {
  if (assets.length <= 1) return null

  // The window is re-sliced around the active id, so the active thumb is always rendered — no
  // scrollIntoView needed, and none here: it would scroll the overflow-hidden viewer column
  // (still a scroll container) and slide the whole stage sideways near the end of the strip.
  const MAX_VISIBLE = 7
  const currentIdx = assets.findIndex((a) => a.id === currentAssetId)
  const half = Math.floor(MAX_VISIBLE / 2)
  const start = Math.max(0, Math.min(currentIdx - half, assets.length - MAX_VISIBLE))
  const visible = assets.slice(start, start + MAX_VISIBLE)

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/60 via-black/30 to-transparent pt-8 pb-3">
      <div className="flex items-center justify-center gap-1.5 px-6">
        {visible.map((asset) => {
          const isActive = asset.id === currentAssetId
          return (
            <button
              key={asset.id}
              onClick={() => onSelect(asset)}
              className={`relative shrink-0 h-14 w-14 rounded overflow-hidden border-2 transition-all duration-150 ${
                isActive
                  ? 'border-primary ring-1 ring-primary/50 scale-110'
                  : 'border-transparent opacity-50 hover:opacity-100 hover:border-white/30'
              }`}
            >
              <AssetThumb asset={asset} eager />
            </button>
          )
        })}
      </div>
    </div>
  )
}
