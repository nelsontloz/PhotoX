import { useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { AssetThumb } from '../AssetThumb'
import type { RelatedAssets } from './useRelatedAssets'

type RelatedTab = 'similar' | 'duplicates'

interface ViewerRelatedTrayProps {
  similar: RelatedAssets
  duplicates: RelatedAssets
  onOpenAsset?: (asset: Asset) => void
}

/**
 * Quiet bottom tray under the media area: two collapsed tabs, each expanding to a horizontal
 * thumb row. Renders nothing until a section has content — no empty blocks, no error noise.
 */
export function ViewerRelatedTray({ similar, duplicates, onOpenAsset }: ViewerRelatedTrayProps) {
  const [active, setActive] = useState<RelatedTab | null>(null)

  if (!onOpenAsset) return null
  // Items, not status: while the next asset's fetch is in flight the hook serves the previous
  // asset's results with status 'loading' (stale-while-revalidate). Gating on 'ready' here made
  // the tray unmount on every next/prev click and flash the media stage.
  const similarVisible = similar.items.length > 0
  const duplicatesVisible = duplicates.total > 0
  if (!similarVisible && !duplicatesVisible) return null

  // the active tab can vanish when the viewer moves to another asset
  const shown: RelatedTab | null =
    active === 'similar' && similarVisible
      ? 'similar'
      : active === 'duplicates' && duplicatesVisible
        ? 'duplicates'
        : null
  const items = shown === 'similar' ? similar.items : shown === 'duplicates' ? duplicates.items : []
  const countLabel =
    shown === 'similar'
      ? `${similar.total} similar ${similar.total === 1 ? 'photo' : 'photos'}`
      : shown === 'duplicates'
        ? `${duplicates.total} possible ${duplicates.total === 1 ? 'duplicate' : 'duplicates'}`
        : ''

  const tabClass = (tab: RelatedTab) =>
    `text-xs font-medium transition-colors ${
      shown === tab ? 'text-primary' : 'text-white/60 hover:text-white'
    }`

  return (
    <section className="shrink-0 bg-black/70 backdrop-blur border-t border-white/10 px-4 sm:px-6 py-2">
      <div className="flex items-center gap-5">
        {similarVisible && (
          <button
            type="button"
            onClick={() => setActive((current) => (current === 'similar' ? null : 'similar'))}
            aria-expanded={shown === 'similar'}
            className={tabClass('similar')}
          >
            More like this
          </button>
        )}
        {duplicatesVisible && (
          <button
            type="button"
            onClick={() => setActive((current) => (current === 'duplicates' ? null : 'duplicates'))}
            aria-expanded={shown === 'duplicates'}
            className={tabClass('duplicates')}
          >
            Possible duplicates
          </button>
        )}
      </div>
      {shown && (
        <div className="mt-2">
          <p className="text-[11px] text-white/50 mb-1.5">{countLabel}</p>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {items.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onOpenAsset(asset)}
                title={asset.originalName ?? asset.title ?? 'Open asset'}
                className="relative h-14 w-14 shrink-0 rounded overflow-hidden border-2 border-transparent hover:border-white/40 transition-colors"
              >
                <AssetThumb asset={asset} eager />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
