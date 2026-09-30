import { useEffect, useCallback, useState } from 'react'
import {
  FaCheck,
  FaCircleExclamation,
  FaFolderPlus,
  FaPhotoFilm,
  FaPlus,
  FaSpinner,
} from 'react-icons/fa6'
import type { AlbumDto } from '@photox/shared-types'
import { addAssetsToAlbum, createAlbum, listAlbums } from '../api/albums'
import { AlbumCover } from './AlbumCover'
import { Dialog, formInputClass } from './Dialog'

interface AlbumPickerDialogProps {
  open: boolean
  onClose: () => void
  assetIds: string[]
  onDone?: () => void
}

export function AlbumPickerDialog({ open, onClose, assetIds, onDone }: AlbumPickerDialogProps) {
  const [albums, setAlbums] = useState<AlbumDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  useEffect(() => {
    if (!open) return
    setAlbums([])
    // matches the old reducer reset: no spinner when the dialog is reopened
    setLoading(false)
    setError(null)
    setSelected(new Set())
    setBusy(false)
    setCreating(false)
    setNewName('')
    setNewDesc('')
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await listAlbums({ limit: 1000 })
        if (ac.signal.aborted) return
        setAlbums(res.items)
      } catch (err) {
        if (ac.signal.aborted) return
        setError((err as Error).message ?? 'Failed to load albums')
      }
    })()
    return () => ac.abort()
  }, [open])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = useCallback(async () => {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      await Promise.all(Array.from(selected).map((id) => addAssetsToAlbum(id, assetIds)))
      onDone?.()
      onClose()
    } catch (err) {
      setError((err as Error).message ?? 'Failed to add to one or more albums')
      setBusy(false)
    }
  }, [selected, assetIds, onDone, onClose])

  const handleCreateAndAdd = useCallback(async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const album = await createAlbum({
        name: trimmed,
        ...(newDesc.trim() ? { description: newDesc.trim() } : {}),
      })
      await addAssetsToAlbum(album.id, assetIds)
      onDone?.()
      onClose()
    } catch (err) {
      setError((err as Error).message ?? 'Failed to create album')
      setBusy(false)
    }
  }, [newName, newDesc, assetIds, onDone, onClose])

  if (!open) return null

  const count = assetIds.length
  const hasAlbums = albums.length > 0
  const trimmedName = newName.trim()

  return (
    <Dialog
      title="Add to albums"
      onClose={onClose}
      panelClassName="bg-card-dark rounded-xl shadow-2xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col"
      icon={<FaFolderPlus className="text-primary text-lg shrink-0" />}
      headerClassName="flex items-center justify-between mb-4 gap-3"
      titleClassName="text-lg font-bold text-white truncate"
      ariaLabel={`Add ${count} ${count === 1 ? 'photo' : 'photos'} to ${count === 1 ? 'album' : 'albums'}`}
    >
      <p className="text-xs text-slate-500 mb-3">
        Adding {count} {count === 1 ? 'photo' : 'photos'} to {count === 1 ? 'album' : 'albums'}
      </p>

      {error && (
        <div className="flex items-center gap-2 text-rose-400 text-sm mb-3 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          <FaCircleExclamation />
          <span>{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
        {loading ? (
          <div className="flex justify-center py-16">
            <FaSpinner className="text-primary text-2xl animate-spin" />
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
              className={formInputClass}
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>Required</span>
              <span className="tabular-nums">{newName.length}/255</span>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 mt-4">
              Description <span className="text-slate-500 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={newDesc}
              rows={3}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="What's this album about?"
              className={`${formInputClass} resize-none`}
            />
          </div>
        ) : !hasAlbums ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mb-3">
              <FaPhotoFilm className="text-2xl text-slate-500" />
            </div>
            <p className="text-slate-300 text-sm font-medium mb-4">No albums yet</p>
            <button
              type="button"
              onClick={() => {
                setCreating(true)
                setError(null)
              }}
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
              onClick={() => {
                setCreating(true)
                setError(null)
              }}
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
                    <AlbumCover
                      albumId={album.id}
                      className="[&_img]:w-full [&_img]:h-full [&_img]:object-cover"
                    />
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
              setError(null)
              setNewName('')
              setNewDesc('')
            }}
            disabled={busy}
            className="text-slate-300 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreateAndAdd()}
            disabled={!trimmedName || busy}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:bg-primary/40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-primary/20"
          >
            {busy ? <FaSpinner className="text-xs animate-spin" /> : <FaPlus className="text-xs" />}
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
              disabled={busy}
              className="text-slate-300 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={selected.size === 0 || busy}
              className="bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? (
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
    </Dialog>
  )
}
