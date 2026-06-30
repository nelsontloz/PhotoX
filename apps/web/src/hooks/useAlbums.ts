import { useEffect, useState } from 'react'
import type { AlbumDto } from '@photox/shared-types'
import { listAlbums, createAlbum, updateAlbum, deleteAlbum } from '../api/albums'

export function useAlbums() {
  const [albums, setAlbums] = useState<AlbumDto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAlbums = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await listAlbums({ limit: 1000 })
      setAlbums(res.items)
      setTotal(res.total)
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load albums')
    } finally {
      setLoading(false)
    }
  }

  const create = async (body: { name: string; description?: string }) => {
    const album = await createAlbum(body)
    await fetchAlbums()
    return album
  }

  const update = async (id: string, body: { name?: string; description?: string }) => {
    const album = await updateAlbum(id, body)
    await fetchAlbums()
    return album
  }

  const remove = async (id: string) => {
    const album = albums.find((a) => a.id === id)
    if (
      !window.confirm(`Delete "${album?.name ?? 'this album'}"? Assets in it will not be deleted.`)
    )
      return
    await deleteAlbum(id)
    await fetchAlbums()
  }

  useEffect(() => {
    void fetchAlbums()
  }, [])

  return { albums, total, loading, error, refresh: fetchAlbums, create, update, remove }
}
