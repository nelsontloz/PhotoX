import { useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { downloadFile } from '../../api/assets'
import { pickViewerThumb, viewerThumbKey } from '../../lib/asset-media'
import { getCachedBlobUrl, peekCachedBlobUrl } from '../../lib/blob-cache'

export function useAssetMedia(asset: Asset): {
  imageUrl: string | null
  videoPosterUrl: string | null
  loading: boolean
} {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const isPhoto = asset.kind === 'photo'
    const thumb = pickViewerThumb(asset)
    if (!thumb) {
      setImageUrl(null)
      setVideoPosterUrl(null)
      setLoading(false)
      return
    }

    const key = viewerThumbKey(thumb)
    const cached = peekCachedBlobUrl(key)
    if (cached) {
      // prefetched neighbor: render the resolved URL synchronously, no fetch, no flash
      if (isPhoto) setImageUrl(cached)
      else setVideoPosterUrl(cached)
      setLoading(false)
      return
    }

    setLoading(true)
    // clear the other kind so a stale image/poster cannot outlive the asset that produced it
    if (isPhoto) setVideoPosterUrl(null)
    else setImageUrl(null)

    getCachedBlobUrl(key, () => downloadFile(thumb.fileId))
      .then(async (url) => {
        // Pre-decode off the main thread so the swap paints the first frame instead of waiting on decode.
        const img = new Image()
        img.src = url
        await img.decode?.().catch(() => undefined)
        if (cancelled) return
        if (isPhoto) setImageUrl(url)
        else setVideoPosterUrl(url)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [asset.id, asset.kind])

  return { imageUrl, videoPosterUrl, loading }
}
