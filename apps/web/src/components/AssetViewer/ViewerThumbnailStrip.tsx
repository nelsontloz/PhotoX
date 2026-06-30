import { useEffect, useRef } from 'react'
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [currentAssetId])

  if (assets.length <= 1) return null

  const MAX_VISIBLE = 7
  const currentIdx = assets.findIndex((a) => a.id === currentAssetId)
  const half = Math.floor(MAX_VISIBLE / 2)
  const start = Math.max(0, Math.min(currentIdx - half, assets.length - MAX_VISIBLE))
  const visible = assets.slice(start, start + MAX_VISIBLE)

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/60 via-black/30 to-transparent pt-8 pb-3">
      <div ref={scrollRef} className="flex items-center justify-center gap-1.5 px-6">
        {visible.map((asset) => {
          const isActive = asset.id === currentAssetId
          return (
            <button
              key={asset.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSelect(asset)}
              className={`relative shrink-0 h-14 w-14 rounded overflow-hidden border-2 transition-all duration-150 ${
                isActive
                  ? 'border-primary ring-1 ring-primary/50 scale-110'
                  : 'border-transparent opacity-50 hover:opacity-100 hover:border-white/30'
              }`}
            >
              <AssetThumb asset={asset} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
