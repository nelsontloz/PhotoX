import { useRef } from 'react'
import { FaXmark } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { ScrollContainerContext } from '../../components/AppShell'
import { GalleryItem } from '../../components/GalleryItem'

interface MapSidePanelProps {
  /** Already capped to what the grid renders; `totalCount` keeps the real bubble size. */
  assets: Asset[]
  totalCount: number
  onClose: () => void
  onSelect: (asset: Asset) => void
}

/** Photo list for the clicked map bubble on the places page. */
export function MapSidePanel({ assets, totalCount, onClose, onSelect }: MapSidePanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const remaining = totalCount - assets.length

  return (
    <aside
      aria-label="Photos in this area"
      className="relative w-80 max-w-full h-full shrink-0 bg-card-dark border-l border-border-dark flex flex-col"
    >
      <div className="h-16 flex items-center px-4 border-b border-border-dark shrink-0">
        <div className="min-w-0">
          <h2 className="text-white font-semibold truncate">
            {totalCount.toLocaleString()} {totalCount === 1 ? 'photo' : 'photos'}
          </h2>
          <p className="text-xs text-slate-400">in this area</p>
        </div>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 text-slate-400 hover:text-white transition-colors"
          aria-label="Close photo list"
        >
          <FaXmark className="text-[20px]" />
        </button>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto upload-queue-scroll p-2">
        {/* AssetThumb's lazy gate keys off the nearest scroll container: the panel body scrolls,
            so it must be the one it observes — AppShell's <main> never clips that inner scroll. */}
        <ScrollContainerContext.Provider value={bodyRef}>
          {assets.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No photos in this area</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="relative aspect-square overflow-hidden rounded-lg bg-background-dark [&>figure]:h-full"
                  >
                    <GalleryItem asset={asset} onSelect={onSelect} />
                  </div>
                ))}
              </div>
              {remaining > 0 && (
                <p className="text-xs text-slate-400 text-center py-3">
                  +{remaining.toLocaleString()} more — zoom in to see them
                </p>
              )}
            </>
          )}
        </ScrollContainerContext.Provider>
      </div>
    </aside>
  )
}
