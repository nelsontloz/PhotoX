import type { Asset } from '@photox/shared-types'
import type { AssetGroup } from '../../hooks/useAssetGroups'
import { GalleryItem } from '../GalleryItem'
import { DropZone } from '../DropZone'

interface TimelineGridProps {
  groups: AssetGroup[]
  onSelect: (asset: Asset) => void
}

export function TimelineGrid({ groups, onSelect }: TimelineGridProps) {
  return (
    <DropZone className="h-full">
      {groups.map((group) => (
        <section key={group.sortKey} className="mb-10">
          <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-transparent dark:border-transparent transition-all">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {group.label}
            </h2>
            <div className="ml-auto flex items-center">
              <button className="text-xs font-semibold text-primary hover:text-primary/80">
                Select all
              </button>
            </div>
          </div>
          <div className="justified-grid-gallery">
            {group.items.map((asset) => {
              return <GalleryItem key={asset.id} asset={asset} onSelect={onSelect} />
            })}
          </div>
        </section>
      ))}
    </DropZone>
  )
}
