import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { downloadFile } from '../api/assets'
import { getCachedBlobUrl } from './blob-cache'

export function pickViewerThumb(asset: Asset): AssetThumbnail | undefined {
  const preferSize = asset.kind === 'photo' ? 'xl' : 'lg'
  return asset.thumbnails?.find((t) => t.size === preferSize) ?? asset.thumbnails?.[0]
}

export function viewerThumbKey(thumb: AssetThumbnail): string {
  return `file:${thumb.fileId}`
}

export function prefetchViewerMedia(asset: Asset): void {
  if (asset.kind !== 'photo' && asset.kind !== 'video') return
  const thumb = pickViewerThumb(asset)
  if (!thumb) return
  void getCachedBlobUrl(viewerThumbKey(thumb), () => downloadFile(thumb.fileId)).catch(
    () => undefined,
  )
}
