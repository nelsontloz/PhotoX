import { useEffect, useRef, useState } from 'react'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { downloadFile } from '../../api/assets'

async function loadAssetThumbBlob(
  thumbs: AssetThumbnail[] | undefined,
  preferSize: 'xl' | 'lg',
  signal?: AbortSignal,
): Promise<string | null> {
  const picked = thumbs?.find((t) => t.size === preferSize) ?? thumbs?.[0]
  if (!picked) return null
  const blob = await downloadFile(picked.fileId, signal)
  return URL.createObjectURL(blob)
}

export function useAssetMedia(asset: Asset): {
  imageUrl: string | null
  videoPosterUrl: string | null
  loading: boolean
} {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // only one of imageUrl / videoPosterUrl is set per asset, so one revoke ref covers both
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setImageUrl(null)
    setVideoPosterUrl(null)
    const isPhoto = asset.kind === 'photo'

    loadAssetThumbBlob(asset.thumbnails, isPhoto ? 'xl' : 'lg', controller.signal)
      .then((url) => {
        if (cancelled || !url) {
          if (!cancelled) setLoading(false)
          return
        }
        urlRef.current = url
        if (isPhoto) setImageUrl(url)
        else setVideoPosterUrl(url)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [asset.id, asset.kind])

  return { imageUrl, videoPosterUrl, loading }
}
