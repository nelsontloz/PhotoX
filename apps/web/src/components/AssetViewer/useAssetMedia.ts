import { useEffect, useRef, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { downloadFile, listThumbnails } from '../../api/assets'

async function loadAssetThumbBlob(
  id: string,
  preferSize: 'xl' | 'lg',
  signal?: AbortSignal,
): Promise<string | null> {
  const thumbs = await listThumbnails(id, signal)
  const picked = thumbs.find((t) => t.size === preferSize) ?? thumbs[0]
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
  const urlRef = useRef<string | null>(null)
  const posterRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setImageUrl(null)
    setVideoPosterUrl(null)

    if (asset.kind === 'photo') {
      loadAssetThumbBlob(asset.id, 'xl', controller.signal)
        .then((url) => {
          if (cancelled || !url) {
            if (!cancelled) setLoading(false)
            return
          }
          urlRef.current = url
          setImageUrl(url)
        })
        .catch(() => {
          if (!cancelled) setLoading(false)
        })
    } else {
      loadAssetThumbBlob(asset.id, 'lg', controller.signal)
        .then((url) => {
          if (cancelled || !url) {
            if (!cancelled) setLoading(false)
            return
          }
          posterRef.current = url
          setVideoPosterUrl(url)
        })
        .catch(() => {
          if (!cancelled) setLoading(false)
        })
    }

    return () => {
      cancelled = true
      controller.abort()
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      if (posterRef.current) {
        URL.revokeObjectURL(posterRef.current)
        posterRef.current = null
      }
    }
  }, [asset.id, asset.kind])

  return { imageUrl, videoPosterUrl, loading }
}
