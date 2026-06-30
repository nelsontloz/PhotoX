import { useEffect, useState } from 'react'
import type { Asset } from '@photox/shared-types'
import { listAlbumAssets, addAssetsToAlbum, removeAssetFromAlbum } from '../api/albums'

export function useAlbumAssets(albumId: string, pageSize = 60) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAssets = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await listAlbumAssets(albumId, { limit: pageSize })
      setAssets(res.items)
      setTotal(res.total)
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load album assets')
    } finally {
      setLoading(false)
    }
  }

  const add = async (assetIds: string[]) => {
    await addAssetsToAlbum(albumId, assetIds)
    await fetchAssets()
  }

  const remove = async (assetId: string) => {
    const asset = assets.find((a) => a.id === assetId)
    if (
      !window.confirm(
        `Remove "${asset?.originalName ?? asset?.title ?? 'this asset'}" from this album?`,
      )
    )
      return
    await removeAssetFromAlbum(albumId, assetId)
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
    removeAsset: remove,
  }
}
