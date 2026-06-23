import type { Asset } from '@photox/shared-types'
import { AssetThumb } from '../AssetThumb'

interface ViewerThumbStripProps {
  assets: Asset[]
  currentId: string
  onSelect: (asset: Asset) => void
}

export function ViewerThumbStrip({ assets, currentId, onSelect }: ViewerThumbStripProps) {
  if (assets.length === 0) return null

  return (
    <div className="h-20 flex items-center justify-center px-6 gap-2 bg-gradient-to-t from-black/40 to-transparent">
      <div className="flex gap-1 overflow-x-auto no-scrollbar py-2">
        {assets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => onSelect(asset)}
            className={`h-10 w-10 rounded border-2 transition-opacity shrink-0 ${
              asset.id === currentId
                ? 'border-primary'
                : 'border-transparent opacity-50 hover:opacity-100'
            }`}
          >
            <AssetThumb asset={asset} aspect="square" className="h-full w-full rounded-sm" />
          </button>
        ))}
      </div>
    </div>
  )
}
