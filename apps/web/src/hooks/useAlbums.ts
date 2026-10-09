import type { AlbumDto } from '@photox/shared-types'
import { listAlbums, createAlbum, updateAlbum, deleteAlbum } from '../api/albums'
import { useConfirm } from '../components/ConfirmProvider'
import { useAsyncFetch } from './useAsyncFetch'

const EMPTY: AlbumDto[] = []

export function useAlbums() {
  const confirm = useConfirm()
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

  const update = async (id: string, body: { name?: string; description?: string }) => {
    const album = await updateAlbum(id, body)
    await refresh()
    return album
  }

  const remove = async (id: string) => {
    const album = albums.find((a) => a.id === id)
    if (
      !(await confirm({
        title: `Delete "${album?.name ?? 'this album'}"?`,
        body: 'Assets in it will not be deleted.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return
    await deleteAlbum(id)
    await refresh()
  }

  return { albums, total: data?.total ?? 0, loading, error, refresh, create, update, remove }
}
