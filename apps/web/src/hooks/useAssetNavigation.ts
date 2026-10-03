import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Asset } from '@photox/shared-types'
import { restoreAsset, trashAsset, updateAsset, deleteAsset } from '../api/assets'
import { useConfirm } from '../components/ConfirmProvider'
import { prefetchViewerMedia } from '../lib/asset-media'
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
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const id = searchParams.get('asset')
  const allAssets = opts.assets
  // Bridges the renders where the param already points at an asset the month cache hasn't landed
  // (deep link, or a resolveBeyond step): set in the same batch as the param, so the viewer never
  // unmounts while React commits the freshly fetched month.
  const [fallback, setFallback] = useState<Asset | null>(null)
  const attemptedMissingRef = useRef(new Set<string>())

  // Sticky per-id resolution: the bounded month cache can evict the open asset's month, which
  // would otherwise unmount the viewer (flash + lost state) and strand the `?asset=` param.
  // ponytail: one entry per viewed asset — negligible next to the month cache; cap it if a
  // session ever views 10k+ assets.
  const resolvedRef = useRef(new Map<string, Asset>())
  const selected = useMemo(() => {
    if (!id) return null
    const found = allAssets.find((a) => a.id === id)
    const asset = found ?? (fallback?.id === id ? fallback : (resolvedRef.current.get(id) ?? null))
    if (asset) resolvedRef.current.set(id, asset)
    return asset
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

  // Neighbor prefetch: give the shared blob cache a head start on prev/next so arrow-key
  // navigation lands on a resolved URL instead of a spinner. Fire-and-forget, no state.
  useEffect(() => {
    if (!selected) return
    const index = allAssets.findIndex((a) => a.id === selected.id)
    if (index < 0) return
    const timer = setTimeout(() => {
      const prev = allAssets[index - 1]
      const next = allAssets[index + 1]
      if (prev) prefetchViewerMedia(prev)
      if (next) prefetchViewerMedia(next)
    }, 300)
    return () => clearTimeout(timer)
  }, [selected, allAssets])

  // True when the layout endpoint still holds items beyond `fromT` in `dir` (partial-data edge).
  const beyond = (dir: NavDirection): boolean =>
    selected !== null && opts.hasBeyond ? opts.hasBeyond(dir, effectiveAssetDate(selected)) : false

  const currentIndex = selected ? allAssets.findIndex((a) => a.id === selected.id) : -1
  const hasPrev = currentIndex > 0 || beyond('prev')
  const hasNext = (currentIndex >= 0 && currentIndex < allAssets.length - 1) || beyond('next')

  // Only `asset` is ours — preserve every other param (e.g. the search page's ?q=), so opening
  // or closing the viewer never drops the page's own query state.
  const setAssetParam = useCallback(
    (assetId: string | null, replace = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (assetId) next.set('asset', assetId)
          else next.delete('asset')
          return next
        },
        { replace },
      )
    },
    [setSearchParams],
  )

  // stable identities: GalleryItem is memoized, so onSelect={nav.open} must not change per render
  const open = useCallback((asset: Asset) => setAssetParam(asset.id), [setAssetParam])
  const close = useCallback(() => setAssetParam(null, true), [setAssetParam])

  const stepTo = (asset: Asset) => setAssetParam(asset.id, true)

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
    const label = selected.originalName ?? selected.title ?? `this ${kindLabel}`
    if (!(await confirm({ title: `Move "${label}" to trash?`, destructive: true }))) return
    try {
      await trashAsset(selected.id)
      close()
      await opts.onAfterAction?.()
    } catch {
      window.alert('Failed to move to trash. Please try again.')
    }
  }

  const restore = async () => {
    if (!selected) return
    try {
      await restoreAsset(selected.id)
      close()
      await opts.onAfterAction?.()
    } catch {
      window.alert('Failed to restore. Please try again.')
    }
  }

  const permanentlyDelete = async () => {
    if (!selected) return
    const kindLabel = selected.kind === 'video' ? 'video' : 'photo'
    const label = selected.originalName ?? selected.title ?? `this ${kindLabel}`
    if (
      !(await confirm({
        title: `Permanently delete "${label}"?`,
        body: 'This cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return
    try {
      await deleteAsset(selected.id)
      close()
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
