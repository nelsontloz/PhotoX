import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Asset } from '@photox/shared-types'
import { restoreAsset, trashAsset } from '../api/assets'

interface UseAssetNavigationOptions {
  assets: Asset[]
  onAfterAction?: () => void | Promise<void>
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
  restore: () => Promise<void>
}

export function useAssetNavigation(opts: UseAssetNavigationOptions): UseAssetNavigationResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const id = searchParams.get('asset')
  const selected = useMemo(
    () => (id ? (opts.assets.find((a) => a.id === id) ?? null) : null),
    [id, opts.assets],
  )

  const allAssets = opts.assets
  const currentIndex = selected ? allAssets.findIndex((a) => a.id === selected.id) : -1
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < allAssets.length - 1

  const open = (asset: Asset) => setSearchParams({ asset: asset.id })
  const close = () => setSearchParams({}, { replace: true })

  const goPrev = () => {
    if (!hasPrev) return
    const prev = allAssets[currentIndex - 1]
    if (!prev) return
    setSearchParams({ asset: prev.id }, { replace: true })
  }
  const goNext = () => {
    if (!hasNext) return
    const next = allAssets[currentIndex + 1]
    if (!next) return
    setSearchParams({ asset: next.id }, { replace: true })
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
      setSearchParams({}, { replace: true })
      await opts.onAfterAction?.()
    } catch {
      window.alert('Failed to move to trash. Please try again.')
    }
  }

  const restore = async () => {
    if (!selected) return
    try {
      await restoreAsset(selected.id)
      setSearchParams({}, { replace: true })
      await opts.onAfterAction?.()
    } catch {
      window.alert('Failed to restore. Please try again.')
    }
  }

  return { selected, open, close, goPrev, goNext, hasPrev, hasNext, trash, restore }
}
