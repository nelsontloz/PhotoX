import type { Asset } from '@photox/shared-types'
import type { AssetGroup } from '../../hooks/useAssetGroups'
import { GalleryItem } from '../GalleryItem'
import { DropZone } from '../DropZone'

interface TimelineGridProps {
  groups: AssetGroup[]
  onSelect: (asset: Asset) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onLongPress?: (asset: Asset) => void
  showCheckbox?: boolean
}

export function TimelineGrid({
  groups,
  onSelect,
  selectedIds,
  onToggleSelect,
  onLongPress,
  showCheckbox = true,
}: TimelineGridProps) {
  const selectionMode = selectedIds.size > 0
  return (
    <DropZone className="h-full">
      {groups.map((group) => {
        const allSelected = group.items.every((item) => selectedIds.has(item.id))
        return (
          <section key={group.sortKey} className="mb-10">
            <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-transparent dark:border-transparent transition-all">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                {group.label}
              </h2>
              <div className="ml-auto flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    group.items.forEach((item) => {
                      if (!allSelected !== !selectedIds.has(item.id)) {
                        onToggleSelect(item.id)
                      }
                    })
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            </div>
            <div className="justified-grid-gallery">
              {group.items.map((asset) => {
                return (
                  <GalleryItem
                    key={asset.id}
                    asset={asset}
                    onSelect={onSelect}
                    selected={selectedIds.has(asset.id)}
                    onToggleSelect={onToggleSelect}
                    onLongPress={onLongPress}
                    showCheckbox={showCheckbox}
                    selectionMode={selectionMode}
                  />
                )
              })}
            </div>
          </section>
        )
      })}
    </DropZone>
  )
}
