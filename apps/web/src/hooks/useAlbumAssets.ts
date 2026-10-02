import { useEffect, useRef, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { listAlbumAssets, addAssetsToAlbum } from '../api/albums'

export function useAlbumAssets(albumId: string, pageSize = 60) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadedOnceRef = useRef(false)

  const fetchAssets = async () => {
    try {
      // ponytail: only the first load blocks the page; refreshes update in place so the viewer isn't unmounted
      if (!loadedOnceRef.current) setLoading(true)
      setError(null)
      const res = await listAlbumAssets(albumId, { limit: pageSize })
      setAssets(res.items)
      setTotal(res.total)
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load album assets')
    } finally {
      loadedOnceRef.current = true
      setLoading(false)
    }
  }

  const add = async (assetIds: string[]) => {
    await addAssetsToAlbum(albumId, assetIds)
    await fetchAssets()
  }

  useEffect(() => {
    void fetchAssets()
  }, [])

  return {
    assets,
    total,
    loading,
    error,
    refresh: fetchAssets,
    addAssets: add,
  }
}
