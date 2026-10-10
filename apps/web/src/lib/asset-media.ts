import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { getFileStreamUrl } from '../api/assets'

export function pickViewerThumb(asset: Asset): AssetThumbnail | undefined {
  const preferSize = asset.kind === 'photo' ? 'xl' : 'lg'
  return asset.thumbnails?.find((t) => t.size === preferSize) ?? asset.thumbnails?.[0]
}

// ponytail: module-level retention so an engine can't GC the discarded <img> before load/error and
// cancel the warm-up request; entries are dropped once the load settles. A Set because a burst of
// prefetches can be in flight at once.
const warming = new Set<HTMLImageElement>()

export function prefetchViewerMedia(asset: Asset): void {
  if (asset.kind !== 'photo' && asset.kind !== 'video') return
  const thumb = pickViewerThumb(asset)
  if (!thumb) return
  // Warm the browser HTTP cache for the same stream URL the viewer will use; a discarded <img> is
  // the cheapest way to ask for exactly that request (cookie included, no state to track).
  const img = new Image()
  warming.add(img)
  img.onload = img.onerror = () => warming.delete(img)
  img.src = getFileStreamUrl(thumb.fileId)
}
