import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FaCircleExclamation,
  FaMagnifyingGlass,
  FaPhotoFilm,
  FaPlus,
  FaSpinner,
  FaXmark,
} from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { AssetThumb } from '../../components/AssetThumb'
import { useAlbums } from '../../hooks/useAlbums'
import { listAlbumAssets } from '../../api/albums'

const NEW_ALBUM_NAME_MAX = 255

function AlbumCover({ albumId }: { albumId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cover, setCover] = useState<Asset | null>(null)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        if (started.current) return
        started.current = true
        listAlbumAssets(albumId, { limit: 1 })
          .then((res) => setCover(res.items[0] ?? null))
          .catch(() => setCover(null))
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [albumId])

  if (cover) {
    return (
      <div
        ref={ref}
        className="absolute inset-0 [&_img]:transition-transform [&_img]:duration-500 [&_img]:ease-out [&_img]:group-hover/cover:scale-110"
      >
        <AssetThumb asset={cover} />
      </div>
    )
  }
  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center">
      <FaPhotoFilm className="text-5xl text-slate-700" />
    </div>
  )
}

interface NewAlbumDialogProps {
  onClose: () => void
  onCreate: (body: { name: string; description?: string }) => Promise<unknown>
}

function NewAlbumDialog({ onClose, onCreate }: NewAlbumDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= NEW_ALBUM_NAME_MAX

  const submit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onCreate({
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
      })
      onClose()
    } catch (err) {
      setError((err as Error).message ?? 'Failed to create album')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-card-dark rounded-xl shadow-2xl w-full max-w-md p-6 border border-border-dark">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-100">New Album</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-100 transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <FaXmark className="text-lg" />
          </button>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          Name
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          maxLength={NEW_ALBUM_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Summer 2025"
          className="w-full bg-background-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors"
        />
        <div className="mt-1 flex justify-between text-[11px] text-slate-500">
          <span>Required</span>
          <span className="tabular-nums">
            {trimmed.length}/{NEW_ALBUM_NAME_MAX}
          </span>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 mt-4">
          Description <span className="text-slate-500 normal-case font-normal">(optional)</span>
        </label>
        <textarea
          value={description}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this album about?"
          className="w-full bg-background-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors resize-none"
        />

        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <FaCircleExclamation className="text-base mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-700/40 rounded-lg transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void submit()
            }}
            disabled={!canSubmit || submitting}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:bg-primary/40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-primary/20"
          >
            {submitting && <FaSpinner className="text-xs animate-spin" />}
            <span>Create</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function AlbumsListContent() {
  const { albums, total, loading, error, refresh, create } = useAlbums()
  const [search, setSearch] = useState('')
  const [showNewDialog, setShowNewDialog] = useState(false)

  const filtered = search.trim()
    ? albums.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()))
    : albums

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <FaSpinner className="text-2xl text-primary animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          type="button"
          onClick={() => {
            void refresh()
          }}
          className="text-primary text-sm font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <header className="flex items-end justify-between gap-4 flex-wrap mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Albums</h1>
          <p className="text-sm text-slate-500 mt-1">
            {total} {total === 1 ? 'album' : 'albums'} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search albums…"
              className="w-full bg-card-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-primary/20 shrink-0"
          >
            <FaPlus className="text-xs" />
            <span>New Album</span>
          </button>
        </div>
      </header>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-lg mx-auto">
          <div className="mb-8 w-20 h-20 rounded-full bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/20 flex items-center justify-center">
            <FaPhotoFilm className="text-4xl text-primary" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
            No albums yet
          </h2>
          <p className="mt-4 text-slate-500 dark:text-slate-400 text-base sm:text-lg leading-relaxed max-w-md">
            Group your photos into collections to keep things organized.
          </p>
          <button
            type="button"
            onClick={() => setShowNewDialog(true)}
            className="mt-8 inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors shadow-lg shadow-primary/20"
          >
            <FaPlus className="text-xs" />
            <span>New Album</span>
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <FaMagnifyingGlass className="text-3xl text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">No albums match "{search.trim()}".</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-8">
          {filtered.map((album) => (
            <Link
              key={album.id}
              to={`/albums/${album.id}`}
              className="group/cover block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
            >
              <div className="aspect-square w-full rounded overflow-hidden bg-card-dark relative shadow-sm transition-shadow group-hover/cover:shadow-xl">
                <AlbumCover albumId={album.id} />
                <div className="absolute inset-0 bg-black/5 opacity-0 group-hover/cover:opacity-100 transition-opacity pointer-events-none" />
              </div>
              <h3 className="font-bold text-slate-100 truncate mt-3">{album.name}</h3>
              <p className="text-sm text-slate-500 mt-0.5">
                {album.assetCount} {album.assetCount === 1 ? 'item' : 'items'}
              </p>
            </Link>
          ))}
        </div>
      )}

      {showNewDialog && (
        <NewAlbumDialog onClose={() => setShowNewDialog(false)} onCreate={create} />
      )}
    </div>
  )
}

export default function AlbumsPage() {
  return (
    <RequireAuth>
      <AppShell>
        <AlbumsListContent />
      </AppShell>
    </RequireAuth>
  )
}
