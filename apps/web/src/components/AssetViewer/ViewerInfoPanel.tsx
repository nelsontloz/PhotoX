import { FaXmark } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { AssetMetadataPanel } from './sections/AssetMetadataPanel'
import { DescriptionSection } from './sections/DescriptionSection'
import { LocationSection } from './sections/LocationSection'

interface ViewerInfoPanelProps {
  asset: Asset
  onClose: () => void
}

export function ViewerInfoPanel({ asset, onClose }: ViewerInfoPanelProps) {
  return (
    <aside className="relative w-80 h-full bg-card-dark border-l border-border-dark flex flex-col shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-border-dark shrink-0">
        <h2 className="text-white font-semibold text-lg">Details</h2>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 text-slate-400 hover:text-white transition-colors"
          aria-label="Close details panel"
        >
          <FaXmark className="text-[20px]" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <AssetMetadataPanel asset={asset} />
        <DescriptionSection asset={asset} />
        <LocationSection asset={asset} />
      </div>
    </aside>
  )
}
