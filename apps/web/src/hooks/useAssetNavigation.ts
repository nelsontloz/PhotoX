import { useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { trashAsset } from '../api/assets'

interface UseAssetNavigationOptions {
  assets: Asset[]
  onAfterTrash?: () => void | Promise<void>
}

interface UseAssetNavigationResult {
  selected: Asset | null
  open: (asset: Asset) => void
  close: () => void
  goPrev: () => void
  goNext: () => void
  hasPrev: boolean
  hasNext: boolean
  trash: () => Promise<void>
}

export function useAssetNavigation(opts: UseAssetNavigationOptions): UseAssetNavigationResult {
  const [selected, setSelected] = useState<Asset | null>(null)

  const allAssets = opts.assets
  const currentIndex = selected ? allAssets.findIndex((a) => a.id === selected.id) : -1
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < allAssets.length - 1

  const open = (asset: Asset) => setSelected(asset)
  const close = () => setSelected(null)
  const goPrev = () => {
    if (hasPrev) setSelected(allAssets[currentIndex - 1] ?? null)
  }
  const goNext = () => {
    if (hasNext) setSelected(allAssets[currentIndex + 1] ?? null)
  }

  const trash = async () => {
    if (!selected) return
    const kindLabel = selected.kind === 'video' ? 'video' : 'photo'
    if (
      !window.confirm(
        `Move "${selected.originalName ?? selected.title ?? `this ${kindLabel}`}" to trash?`,
      )
    )
      return
    try {
      await trashAsset(selected.id)
      close()
      await opts.onAfterTrash?.()
    } catch {
      window.alert('Failed to move to trash. Please try again.')
    }
  }

  return { selected, open, close, goPrev, goNext, hasPrev, hasNext, trash }
}
