import type { Asset } from '@photox/shared-types'
import { listAlbumAssets, addAssetsToAlbum } from '../api/albums'
import { useAsyncFetch } from './useAsyncFetch'

const PAGE_SIZE = 60
const EMPTY: Asset[] = []

export function useAlbumAssets(albumId: string) {
  const { data, loading, error, refresh } = useAsyncFetch(
    () => listAlbumAssets(albumId, { limit: PAGE_SIZE }),
    { errorMessage: 'Failed to load album assets' },
  )

  const add = async (assetIds: string[]) => {
    await addAssetsToAlbum(albumId, assetIds)
    await refresh()
  }

  return {
    assets: data?.items ?? EMPTY,
    total: data?.total ?? 0,
    loading,
    error,
    refresh,
    addAssets: add,
  }
}
