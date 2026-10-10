import { useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { getFileStreamUrl } from '../../api/assets'
import { pickViewerThumb } from '../../lib/asset-media'

export function useAssetMedia(asset: Asset): {
  imageUrl: string | null
  videoPosterUrl: string | null
  placeholderUrl: string | null
  loading: boolean
} {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // The strip already requested this md thumb, so the browser HTTP cache serves it while the
  // full-size stream loads: a synchronous stand-in to stretch+blur.
  const mdThumb = asset.thumbnails?.find((t) => t.size === 'md') ?? asset.thumbnails?.[0]
  const placeholderUrl = mdThumb ? getFileStreamUrl(mdThumb.fileId) : null
  const thumb = pickViewerThumb(asset)

  // Deps include thumb?.fileId: thumbnails can arrive in a later fetch with the same id/kind
  // (viewer opened before processing finished), and the effect must rerun for the new stream URL.
  useEffect(() => {
    let cancelled = false
    const isPhoto = asset.kind === 'photo'
    if (!thumb) {
      setImageUrl(null)
      setVideoPosterUrl(null)
      setLoading(false)
      return
    }

    setLoading(true)
    // clear both: a stale image/poster must not outlive the asset that produced it
    setImageUrl(null)
    setVideoPosterUrl(null)

    const url = getFileStreamUrl(thumb.fileId)
    void (async () => {
      // Pre-decode off the main thread so the swap paints the first frame instead of waiting on decode.
      const img = new Image()
      img.src = url
      try {
        await img.decode?.()
      } catch {
        // Network/decode failure: leave both URLs null so ViewerMedia renders its no-preview state.
        if (!cancelled) setLoading(false)
        return
      }
      if (cancelled) return
      if (isPhoto) setImageUrl(url)
      else setVideoPosterUrl(url)
    })()

    return () => {
      cancelled = true
    }
  }, [asset.id, asset.kind, thumb?.fileId])

  return { imageUrl, videoPosterUrl, placeholderUrl, loading }
}
