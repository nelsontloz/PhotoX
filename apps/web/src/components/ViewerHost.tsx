import { lazy, Suspense } from 'react'
import type { Asset } from '@photox/shared-types'
import { AssetViewer } from './AssetViewer/AssetViewer'

// Only needed when the picker opens — keep it out of the shared gallery chunk.
const AlbumPickerDialog = lazy(() =>
  import('./AlbumPickerDialog').then((m) => ({ default: m.AlbumPickerDialog })),
)

interface ViewerHostProps {
  /** Mounts the viewer while non-null; the picker's open state is independent. */
  asset: Asset | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev: boolean
  hasNext: boolean
  onTrash?: () => void
  onRestore?: () => void
  onDelete?: () => void
  onToggleFavorite?: (nextValue: boolean) => void
  onAddToAlbum?: () => void
  onRemoveFromAlbum?: () => void
  siblingAssets?: Asset[]
  onSelectSibling?: (asset: Asset) => void
  pickerOpen: boolean
  onPickerClose: () => void
  /** Defaults to the open asset; pages that select several pass their own list. */
  pickerAssetIds?: string[]
  onPickerDone?: () => void
}

/** One mount point for the asset viewer plus its add-to-albums dialog, shared by gallery pages. */
export function ViewerHost({
  asset,
  onClose,
  pickerOpen,
  onPickerClose,
  pickerAssetIds,
  onPickerDone,
  ...viewerProps
}: ViewerHostProps) {
  return (
    <>
      {asset && <AssetViewer asset={asset} onClose={onClose} {...viewerProps} />}
      {asset != null && pickerOpen && (
        <Suspense fallback={null}>
          <AlbumPickerDialog
            open
            onClose={onPickerClose}
            assetIds={pickerAssetIds ?? [asset.id]}
            onDone={onPickerDone}
          />
        </Suspense>
      )}
    </>
  )
}
