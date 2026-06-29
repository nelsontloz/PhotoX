import { useEffect, useRef, useState } from 'react'
import {
  FaCheck,
  FaCircleExclamation,
  FaFolderPlus,
  FaPhotoFilm,
  FaPlus,
  FaSpinner,
  FaXmark,
} from 'react-icons/fa6'
import type { AlbumDto, Asset } from '@photox/shared-types'
import { addAssetsToAlbum, createAlbum, listAlbums, listAlbumAssets } from '../api/albums'
import { AssetThumb } from './AssetThumb'

interface AlbumPickerDialogProps {
  open: boolean
  onClose: () => void
  assetIds: string[]
  onDone?: () => void
}

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
        className="absolute inset-0 [&_img]:w-full [&_img]:h-full [&_img]:object-cover"
      >
        <AssetThumb asset={cover} />
      </div>
    )
  }
  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center">
      <FaPhotoFilm className="text-2xl text-slate-700" />
    </div>
  )
}

const fieldClass =
  'w-full bg-background-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors'

export function AlbumPickerDialog({ open, onClose, assetIds, onDone }: AlbumPickerDialogProps) {
  const [albums, setAlbums] = useState<AlbumDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingSubmit, setCreatingSubmit] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setSelected(new Set())
    setCreating(false)
    setNewName('')
    setNewDesc('')
    setCreateError(null)
    setSubmitError(null)
    void (async () => {
      try {
        const res = await listAlbums({ limit: 1000 })
        if (cancelled) return
        setAlbums(res.items)
      } catch (err) {
        if (cancelled) return
        setLoadError((err as Error).message ?? 'Failed to load albums')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = async () => {
    if (selected.size === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await Promise.all(Array.from(selected).map((albumId) => addAssetsToAlbum(albumId, assetIds)))
      onDone?.()
      onClose()
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Failed to add to one or more albums')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateAndAdd = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    setCreatingSubmit(true)
    setCreateError(null)
    try {
      const album = await createAlbum({
        name: trimmed,
        ...(newDesc.trim() ? { description: newDesc.trim() } : {}),
      })
      await addAssetsToAlbum(album.id, assetIds)
      onDone?.()
      onClose()
    } catch (err) {
      setCreateError((err as Error).message ?? 'Failed to create album')
    } finally {
      setCreatingSubmit(false)
    }
  }

  if (!open) return null

  const count = assetIds.length
  const hasAlbums = albums.length > 0
  const trimmedName = newName.trim()

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${count} ${count === 1 ? 'photo' : 'photos'} to ${count === 1 ? 'album' : 'albums'}`}
    >
      <div
        className="bg-card-dark rounded-xl shadow-2xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FaFolderPlus className="text-primary text-lg shrink-0" />
            <h2 className="text-lg font-bold text-white truncate">Add to albums</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 shrink-0"
            aria-label="Close"
          >
            <FaXmark className="text-lg" />
          </button>
        </div>

        <p className="text-xs text-slate-500 mb-3">
          Adding {count} {count === 1 ? 'photo' : 'photos'} to {count === 1 ? 'album' : 'albums'}
        </p>

        {submitError && (
          <div className="flex items-center gap-2 text-rose-400 text-sm mb-3 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            <FaCircleExclamation />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          {loading ? (
            <div className="flex justify-center py-16">
              <FaSpinner className="text-primary text-2xl animate-spin" />
            </div>
          ) : loadError ? (
            <div className="flex items-center justify-center gap-2 text-rose-400 text-sm py-12">
              <FaCircleExclamation />
              <span>{loadError}</span>
            </div>
          ) : creating ? (
            <div className="py-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Name
              </label>
              <input
                autoFocus
                type="text"
                value={newName}
                maxLength={255}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Summer 2025"
                className={fieldClass}
              />
              <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                <span>Required</span>
                <span className="tabular-nums">{newName.length}/255</span>
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 mt-4">
                Description{' '}
                <span className="text-slate-500 normal-case font-normal">(optional)</span>
              </label>
              <textarea
                value={newDesc}
                rows={3}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What's this album about?"
                className={`${fieldClass} resize-none`}
              />

              {createError && (
                <div className="mt-4 flex items-start gap-2 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  <FaCircleExclamation className="text-base mt-0.5 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}
            </div>
          ) : !hasAlbums ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mb-3">
                <FaPhotoFilm className="text-2xl text-slate-500" />
              </div>
              <p className="text-slate-300 text-sm font-medium mb-4">No albums yet</p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-primary/20"
              >
                <FaPlus className="text-xs" />
                Create your first album
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex items-center gap-3 p-2 rounded-lg text-left ring-1 ring-border-dark bg-white/5 hover:bg-white/10 transition-colors"
              >
                <div className="size-14 rounded bg-primary/10 flex items-center justify-center shrink-0">
                  <FaPlus className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">New album</p>
                  <p className="text-xs text-slate-500">Create a new one</p>
                </div>
              </button>
              {albums.map((album) => {
                const isSelected = selected.has(album.id)
                return (
                  <button
                    key={album.id}
                    type="button"
                    onClick={() => toggle(album.id)}
                    className={[
                      'flex items-center gap-3 p-2 rounded-lg text-left transition-colors',
                      isSelected
                        ? 'ring-2 ring-primary bg-primary/10'
                        : 'ring-1 ring-transparent hover:bg-white/5',
                    ].join(' ')}
                    aria-pressed={isSelected}
                  >
                    <div className="size-14 rounded overflow-hidden bg-card-dark relative shrink-0 ring-1 ring-border-dark">
                      <AlbumCover albumId={album.id} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{album.name}</p>
                      <p className="text-xs text-slate-500">
                        {album.assetCount} {album.assetCount === 1 ? 'item' : 'items'}
                      </p>
                    </div>
                    <div
                      className={[
                        'size-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                        isSelected
                          ? 'bg-primary border-primary text-white'
                          : 'border-slate-600 text-transparent',
                      ].join(' ')}
                      aria-hidden="true"
                    >
                      {isSelected && <FaCheck className="text-[10px]" />}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {creating ? (
          <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border-dark">
            <button
              type="button"
              onClick={() => {
                setCreating(false)
                setCreateError(null)
              }}
              disabled={creatingSubmit}
              className="text-slate-300 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleCreateAndAdd()
              }}
              disabled={!trimmedName || creatingSubmit}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:bg-primary/40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-primary/20"
            >
              {creatingSubmit ? (
                <FaSpinner className="text-xs animate-spin" />
              ) : (
                <FaPlus className="text-xs" />
              )}
              Create
            </button>
          </div>
        ) : hasAlbums ? (
          <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-border-dark">
            <span className="text-xs text-slate-500">
              {selected.size > 0
                ? `${selected.size} ${selected.size === 1 ? 'album' : 'albums'} selected`
                : 'Select albums to add to'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="text-slate-300 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleAdd()
                }}
                disabled={selected.size === 0 || submitting}
                className="bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <FaSpinner className="text-xs animate-spin" />
                ) : (
                  <FaPlus className="text-xs" />
                )}
                Add to {selected.size} album{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end mt-4 pt-4 border-t border-border-dark">
            <button
              type="button"
              onClick={onClose}
              className="text-slate-300 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-md transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
