import { useEffect, useReducer, useCallback } from 'react'
import {
  FaCheck,
  FaCircleExclamation,
  FaFolderPlus,
  FaPhotoFilm,
  FaPlus,
  FaSpinner,
  FaXmark,
} from 'react-icons/fa6'
import type { AlbumDto } from '@photox/shared-types'
import { addAssetsToAlbum, createAlbum, listAlbums } from '../api/albums'
import { AlbumCover } from './AlbumCover'

interface AlbumPickerDialogProps {
  open: boolean
  onClose: () => void
  assetIds: string[]
  onDone?: () => void
}

const fieldClass =
  'w-full bg-background-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors'

interface State {
  albums: AlbumDto[]
  loading: boolean
  error: string | null
  selected: Set<string>
  busy: boolean
  creating: boolean
  newName: string
  newDesc: string
}

type Action =
  | { type: 'reset' }
  | { type: 'loaded'; albums: AlbumDto[] }
  | { type: 'loadError'; error: string }
  | { type: 'toggle'; id: string }
  | { type: 'busy'; busy: boolean }
  | { type: 'error'; error: string | null }
  | { type: 'startCreate' }
  | { type: 'cancelCreate' }
  | { type: 'setName'; name: string }
  | { type: 'setDesc'; desc: string }

const initial: State = {
  albums: [],
  loading: true,
  error: null,
  selected: new Set(),
  busy: false,
  creating: false,
  newName: '',
  newDesc: '',
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return { ...initial, loading: false }
    case 'loaded':
      return { ...state, albums: action.albums, loading: false }
    case 'loadError':
      return { ...state, error: action.error, loading: false }
    case 'toggle': {
      const next = new Set(state.selected)
      if (next.has(action.id)) next.delete(action.id)
      else next.add(action.id)
      return { ...state, selected: next }
    }
    case 'busy':
      return { ...state, busy: action.busy }
    case 'error':
      return { ...state, error: action.error, busy: false }
    case 'startCreate':
      return { ...state, creating: true, error: null }
    case 'cancelCreate':
      return { ...state, creating: false, error: null, newName: '', newDesc: '' }
    case 'setName':
      return { ...state, newName: action.name }
    case 'setDesc':
      return { ...state, newDesc: action.desc }
  }
}

export function AlbumPickerDialog({ open, onClose, assetIds, onDone }: AlbumPickerDialogProps) {
  const [state, dispatch] = useReducer(reducer, initial)

  useEffect(() => {
    if (!open) return
    dispatch({ type: 'reset' })
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await listAlbums({ limit: 1000 })
        if (ac.signal.aborted) return
        dispatch({ type: 'loaded', albums: res.items })
      } catch (err) {
        if (ac.signal.aborted) return
        dispatch({ type: 'loadError', error: (err as Error).message ?? 'Failed to load albums' })
      }
    })()
    return () => ac.abort()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleAdd = useCallback(async () => {
    if (state.selected.size === 0) return
    dispatch({ type: 'busy', busy: true })
    dispatch({ type: 'error', error: null })
    try {
      await Promise.all(Array.from(state.selected).map((id) => addAssetsToAlbum(id, assetIds)))
      onDone?.()
      onClose()
    } catch (err) {
      dispatch({
        type: 'error',
        error: (err as Error).message ?? 'Failed to add to one or more albums',
      })
    }
  }, [state.selected, assetIds, onDone, onClose])

  const handleCreateAndAdd = useCallback(async () => {
    const trimmed = state.newName.trim()
    if (!trimmed) return
    dispatch({ type: 'busy', busy: true })
    dispatch({ type: 'error', error: null })
    try {
      const album = await createAlbum({
        name: trimmed,
        ...(state.newDesc.trim() ? { description: state.newDesc.trim() } : {}),
      })
      await addAssetsToAlbum(album.id, assetIds)
      onDone?.()
      onClose()
    } catch (err) {
      dispatch({ type: 'error', error: (err as Error).message ?? 'Failed to create album' })
    }
  }, [state.newName, state.newDesc, assetIds, onDone, onClose])

  if (!open) return null

  const count = assetIds.length
  const hasAlbums = state.albums.length > 0
  const trimmedName = state.newName.trim()

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

        {state.error && (
          <div className="flex items-center gap-2 text-rose-400 text-sm mb-3 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            <FaCircleExclamation />
            <span>{state.error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          {state.loading ? (
            <div className="flex justify-center py-16">
              <FaSpinner className="text-primary text-2xl animate-spin" />
            </div>
          ) : state.creating ? (
            <div className="py-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Name
              </label>
              <input
                autoFocus
                type="text"
                value={state.newName}
                maxLength={255}
                onChange={(e) => dispatch({ type: 'setName', name: e.target.value })}
                placeholder="e.g. Summer 2025"
                className={fieldClass}
              />
              <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                <span>Required</span>
                <span className="tabular-nums">{state.newName.length}/255</span>
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 mt-4">
                Description{' '}
                <span className="text-slate-500 normal-case font-normal">(optional)</span>
              </label>
              <textarea
                value={state.newDesc}
                rows={3}
                onChange={(e) => dispatch({ type: 'setDesc', desc: e.target.value })}
                placeholder="What's this album about?"
                className={`${fieldClass} resize-none`}
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
                onClick={() => dispatch({ type: 'startCreate' })}
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
                onClick={() => dispatch({ type: 'startCreate' })}
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
              {state.albums.map((album) => {
                const isSelected = state.selected.has(album.id)
                return (
                  <button
                    key={album.id}
                    type="button"
                    onClick={() => dispatch({ type: 'toggle', id: album.id })}
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

        {state.creating ? (
          <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border-dark">
            <button
              type="button"
              onClick={() => dispatch({ type: 'cancelCreate' })}
              disabled={state.busy}
              className="text-slate-300 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreateAndAdd()}
              disabled={!trimmedName || state.busy}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:bg-primary/40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-primary/20"
            >
              {state.busy ? (
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
              {state.selected.size > 0
                ? `${state.selected.size} ${state.selected.size === 1 ? 'album' : 'albums'} selected`
                : 'Select albums to add to'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={state.busy}
                className="text-slate-300 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={state.selected.size === 0 || state.busy}
                className="bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {state.busy ? (
                  <FaSpinner className="text-xs animate-spin" />
                ) : (
                  <FaPlus className="text-xs" />
                )}
                Add to {state.selected.size} album{state.selected.size === 1 ? '' : 's'}
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
