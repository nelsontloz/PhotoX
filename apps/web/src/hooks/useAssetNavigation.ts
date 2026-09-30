import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Asset } from '@photox/shared-types'
import { restoreAsset, trashAsset, updateAsset, deleteAsset } from '../api/assets'
import { effectiveAssetDate, monthKeyOf } from '../lib/dateFormat'

type NavDirection = 'prev' | 'next'

// Calendar distance between YYYY-MM keys. > 1 means a whole month sits between two loaded
// months (only possible via a deep link into a non-adjacent month), so an index step across it
// would skip whatever lies between — route through resolveBeyond and let the layout decide.
function monthDistance(a: string, b: string): number {
  const [ay, am] = a.split('-')
  const [by, bm] = b.split('-')
  return Math.abs(Number(ay) * 12 + Number(am) - (Number(by) * 12 + Number(bm)))
}

interface UseAssetNavigationOptions {
  assets: Asset[]
  onAfterAction?: () => void | Promise<void>
  /**
   * Timeline-only (partial data): does the LAYOUT endpoint hold an item beyond `fromT` in `dir`?
   * Keeps prev/next enabled at the edge of the loaded set. Omitted → pure index walking, as before.
   */
  hasBeyond?: (dir: NavDirection, fromT: string) => boolean
  /**
   * Loads the month adjacent to `fromT` and resolves with the next asset to step to
   * (null when the library really ends there or the fetch fails).
   */
  resolveBeyond?: (dir: NavDirection, fromT: string) => Promise<Asset | null>
  /** Deep link (`?asset=` for an asset whose month isn't fetched) — resolve it directly. */
  resolveMissing?: (id: string) => Promise<Asset | null>
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
  permanentlyDelete: () => Promise<void>
  toggleFavorite: (assetId: string, nextValue: boolean) => Promise<void>
}

export function useAssetNavigation(opts: UseAssetNavigationOptions): UseAssetNavigationResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const id = searchParams.get('asset')
  const allAssets = opts.assets
  // Bridges the renders where the param already points at an asset the month cache hasn't landed
  // (deep link, or a resolveBeyond step): set in the same batch as the param, so the viewer never
  // unmounts while React commits the freshly fetched month.
  const [fallback, setFallback] = useState<Asset | null>(null)
  const attemptedMissingRef = useRef(new Set<string>())

  const selected = useMemo(() => {
    if (!id) return null
    const found = allAssets.find((a) => a.id === id)
    if (found) return found
    return fallback?.id === id ? fallback : null
  }, [id, allAssets, fallback])

  // Deep link to an asset whose month isn't fetched → fetch the asset itself (once per id).
  useEffect(() => {
    if (!id || !opts.resolveMissing || fallback?.id === id) return
    if (allAssets.some((a) => a.id === id)) return
    if (attemptedMissingRef.current.has(id)) return
    attemptedMissingRef.current.add(id)
    void opts.resolveMissing(id).then((asset) => {
      if (asset) setFallback(asset)
    })
  }, [id, allAssets, fallback, opts.resolveMissing])

  // True when the layout endpoint still holds items beyond `fromT` in `dir` (partial-data edge).
  const beyond = (dir: NavDirection): boolean =>
    selected !== null && opts.hasBeyond ? opts.hasBeyond(dir, effectiveAssetDate(selected)) : false

  const currentIndex = selected ? allAssets.findIndex((a) => a.id === selected.id) : -1
  const hasPrev = currentIndex > 0 || beyond('prev')
  const hasNext = (currentIndex >= 0 && currentIndex < allAssets.length - 1) || beyond('next')

  const open = (asset: Asset) => setSearchParams({ asset: asset.id })
  const close = () => setSearchParams({}, { replace: true })

  const stepTo = (asset: Asset) => setSearchParams({ asset: asset.id }, { replace: true })

  const step = (dir: NavDirection) => {
    if (dir === 'prev' ? !hasPrev : !hasNext) return
    const delta = dir === 'prev' ? -1 : 1
    const target = currentIndex >= 0 ? allAssets[currentIndex + delta] : undefined
    // plain index walk when the loaded set is contiguous (or when there is no layout info at
    // all — favorites/trash fetch everything, exactly as before)
    const contiguous =
      !opts.resolveBeyond ||
      (target !== undefined &&
        selected !== null &&
        monthDistance(
          monthKeyOf(effectiveAssetDate(target)),
          monthKeyOf(effectiveAssetDate(selected)),
        ) <= 1)
    if (target && contiguous) {
      stepTo(target)
      return
    }
    // at the loaded boundary (or across a gap): load the adjacent month, then step into it
    if (!selected || !opts.resolveBeyond) return
    void opts.resolveBeyond(dir, effectiveAssetDate(selected)).then((asset) => {
      if (!asset) return
      setFallback(asset)
      stepTo(asset)
    })
  }
  const goPrev = () => step('prev')
  const goNext = () => step('next')

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

  const permanentlyDelete = async () => {
    if (!selected) return
    const kindLabel = selected.kind === 'video' ? 'video' : 'photo'
    if (
      !window.confirm(
        `Permanently delete "${selected.originalName ?? selected.title ?? `this ${kindLabel}`}"? This cannot be undone.`,
      )
    )
      return
    try {
      await deleteAsset(selected.id)
      setSearchParams({}, { replace: true })
      await opts.onAfterAction?.()
    } catch {
      window.alert('Failed to permanently delete. Please try again.')
    }
  }

  const toggleFavorite = async (assetId: string, nextValue: boolean) => {
    try {
      await updateAsset(assetId, { favorite: nextValue })
      await opts.onAfterAction?.()
    } catch {
      window.alert('Failed to update favorite. Please try again.')
    }
  }

  return {
    selected,
    open,
    close,
    goPrev,
    goNext,
    hasPrev,
    hasNext,
    trash,
    restore,
    permanentlyDelete,
    toggleFavorite,
  }
}
