import { FaXmark } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { DescriptionSection } from './sections/DescriptionSection'
import { CameraSection } from './sections/CameraSection'
import { LocationSection } from './sections/LocationSection'
import { AlbumsSection } from './sections/AlbumsSection'
import { KeywordsSection } from './sections/KeywordsSection'
import { ActionsSection } from './sections/ActionsSection'

interface ViewerInfoPanelProps {
  asset: Asset
  open: boolean
  onClose: () => void
}

export function ViewerInfoPanel({ asset, open, onClose }: ViewerInfoPanelProps) {
  if (!open) return null

  return (
    <aside className="w-80 h-full bg-card-dark border-l border-border-dark flex flex-col shrink-0 max-md:absolute max-md:right-0 max-md:top-0 max-md:z-30">
      <div className="h-16 flex items-center px-6 border-b border-border-dark shrink-0">
        <h2 className="text-white font-semibold text-lg">Details</h2>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 text-slate-400 hover:text-white transition-colors"
        >
          <FaXmark className="text-base" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <DescriptionSection asset={asset} />
        <CameraSection asset={asset} />
        <LocationSection asset={asset} />
        <AlbumsSection />
        <KeywordsSection />
        <ActionsSection />
      </div>
    </aside>
  )
}
