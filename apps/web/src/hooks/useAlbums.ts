import type { AlbumDto } from '@photox/shared-types'
import { listAlbums, createAlbum } from '../api/albums'
import { useAsyncFetch } from './useAsyncFetch'

const EMPTY: AlbumDto[] = []

export function useAlbums() {
  const { data, loading, error, refresh } = useAsyncFetch(() => listAlbums({ limit: 1000 }), {
    errorMessage: 'Failed to load albums',
    loadingMode: 'always',
  })
  const albums = data?.items ?? EMPTY

  const create = async (body: { name: string; description?: string }) => {
    const album = await createAlbum(body)
    await refresh()
    return album
  }

  return { albums, total: data?.total ?? 0, loading, error, refresh, create }
}
