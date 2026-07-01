import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  FaArrowLeft,
  FaCheck,
  FaCircleExclamation,
  FaEllipsisVertical,
  FaPenToSquare,
  FaPhotoFilm,
  FaPlus,
  FaSpinner,
  FaTrash,
  FaXmark,
} from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { GalleryItem } from '../../components/GalleryItem'
import { AlbumPickerDialog } from '../../components/AlbumPickerDialog'
import { listAssets } from '../../api/assets'
import { getAlbum, removeAssetFromAlbum } from '../../api/albums'
import { useAlbumAssets } from '../../hooks/useAlbumAssets'
import { useAlbums } from '../../hooks/useAlbums'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import type { AlbumDto, Asset } from '@photox/shared-types'

const AssetViewer = lazy(() =>
  import('../../components/AssetViewer/AssetViewer').then((m) => ({ default: m.AssetViewer })),
)

export default function AlbumDetailPage() {
  return (
    <RequireAuth>
      <AppShell>
        <AlbumDetailContent />
      </AppShell>
    </RequireAuth>
  )
}

function AlbumDetailContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [album, setAlbum] = useState<AlbumDto | null>(null)
  const [loadingAlbum, setLoadingAlbum] = useState(true)
  const [albumNotFound, setAlbumNotFound] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const { update, remove } = useAlbums()
  const {
    assets,
    total,
    loading: loadingAssets,
    error: assetsError,
    refresh,
    addAssets,
  } = useAlbumAssets(id ?? '', 60)

  const refreshAlbum = async () => {
    if (!id) return
    try {
      const fresh = await getAlbum(id)
      setAlbum(fresh)
    } catch {
      /* ponytail: silent fail, page will surface via the initial load */
    }
  }

  const nav = useAssetNavigation({
    assets,
    onAfterAction: async () => {
      await Promise.all([refresh(), refreshAlbum()])
    },
  })

  useEffect(() => {
    if (!id) return
    setLoadingAlbum(true)
    setAlbumNotFound(false)
    void (async () => {
      try {
        const fresh = await getAlbum(id)
        setAlbum(fresh)
        setNameValue(fresh.name)
      } catch {
        setAlbumNotFound(true)
      } finally {
        setLoadingAlbum(false)
      }
    })()
  }, [id])

  useEffect(() => {
    if (!showMenu) return
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [showMenu])

  const startRename = () => {
    if (!album) return
    setNameValue(album.name)
    setEditingName(true)
    setShowMenu(false)
  }

  const commitRename = async () => {
    if (!id || !album) return
    const trimmed = nameValue.trim()
    if (trimmed === '' || trimmed === album.name) {
      setNameValue(album.name)
      setEditingName(false)
      return
    }
    try {
      const updated = await update(id, { name: trimmed })
      setAlbum(updated)
      setNameValue(updated.name)
    } catch {
      setNameValue(album.name)
    } finally {
      setEditingName(false)
    }
  }

  const cancelRename = () => {
    if (album) setNameValue(album.name)
    setEditingName(false)
  }

  const handleDelete = async () => {
    if (!id) return
    setShowMenu(false)
    try {
      await remove(id)
      void navigate('/albums')
    } catch {
      /* ponytail: useAlbums.remove handles its own confirm, navigation only on success */
    }
  }

  const handleEditDescription = () => {
    if (!id) return
    setShowMenu(false)
    const current = album?.description ?? ''
    const next = window.prompt('Album description', current)
    if (next === null) return
    void (async () => {
      try {
        const updated = await update(id, { description: next })
        setAlbum(updated)
      } catch {
        /* ponytail: silent fail */
      }
    })()
  }

  if (albumNotFound) {
    return (
      <div className="max-w-6xl mx-auto">
        <button
          onClick={() => void navigate('/albums')}
          className="text-slate-400 hover:text-white transition-colors mb-6 inline-flex items-center gap-2 text-sm"
        >
          <FaArrowLeft className="text-base" />
          Back to albums
        </button>
        <div className="flex flex-col items-center justify-center py-20">
          <FaPhotoFilm className="text-4xl text-slate-500 mb-4" />
          <p className="text-slate-400">Album not found</p>
        </div>
      </div>
    )
  }

  if (loadingAlbum || loadingAssets) {
    return (
      <div className="flex justify-center py-20">
        <FaSpinner className="text-primary text-2xl animate-spin" />
      </div>
    )
  }

  if (!album) return null

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <button
          onClick={() => void navigate('/albums')}
          className="text-slate-400 hover:text-white transition-colors"
          aria-label="Back to albums"
        >
          <FaArrowLeft className="text-xl" />
        </button>
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={() => {
              void commitRename()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename()
              if (e.key === 'Escape') cancelRename()
            }}
            className="text-2xl font-bold text-white bg-transparent border-b border-primary outline-none flex-1 min-w-[12rem] py-1"
          />
        ) : (
          <h1
            onClick={startRename}
            className="text-2xl font-bold text-white cursor-pointer hover:text-primary transition-colors"
            title="Click to rename"
          >
            {album.name}
          </h1>
        )}
        <span className="text-slate-400 text-sm whitespace-nowrap">
          {album.assetCount} {album.assetCount === 1 ? 'item' : 'items'}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowAddDialog(true)}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors"
          >
            <FaPlus className="text-xs" />
            Add photos
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/5"
              aria-label="Album options"
              aria-expanded={showMenu}
            >
              <FaEllipsisVertical />
            </button>
            {showMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-card-dark border border-border-dark rounded-lg shadow-lg py-1 z-20">
                <button
                  onClick={startRename}
                  className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-white/5 inline-flex items-center gap-2"
                >
                  <FaPenToSquare className="text-xs" />
                  Edit name
                </button>
                <button
                  onClick={handleEditDescription}
                  className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-white/5 inline-flex items-center gap-2"
                >
                  <FaPenToSquare className="text-xs" />
                  Edit description
                </button>
                <div className="my-1 border-t border-border-dark" />
                <button
                  onClick={() => {
                    void handleDelete()
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 inline-flex items-center gap-2"
                >
                  <FaTrash className="text-xs" />
                  Delete album
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {album.description && (
        <p className="text-slate-400 text-sm mb-6 max-w-3xl whitespace-pre-line">
          {album.description}
        </p>
      )}

      {assetsError && (
        <div className="flex items-center gap-2 text-rose-400 text-sm mb-4 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
          <FaCircleExclamation />
          <span>{assetsError}</span>
        </div>
      )}

      {assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
          <div className="mb-6 w-20 h-20 rounded-full bg-white/5 flex items-center justify-center">
            <FaPhotoFilm className="text-3xl text-slate-500" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No photos in this album yet</h2>
          <p className="text-slate-400 text-sm mb-6">Add photos to see them here</p>
          <button
            onClick={() => setShowAddDialog(true)}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-4 py-2 rounded-md inline-flex items-center gap-2 transition-colors"
          >
            <FaPlus className="text-xs" />
            Add photos
          </button>
        </div>
      ) : (
        <>
          <div className="justified-grid-gallery">
            {assets.map((asset) => (
              <GalleryItem key={asset.id} asset={asset} onSelect={nav.open} />
            ))}
          </div>
          {total > assets.length && (
            <div className="flex justify-center mt-6">
              <p className="text-sm text-slate-400">
                Showing {assets.length} of {total}
              </p>
            </div>
          )}
        </>
      )}

      {nav.selected && (
        <Suspense fallback={null}>
          <AssetViewer
            asset={nav.selected}
            onClose={nav.close}
            onPrev={nav.goPrev}
            onNext={nav.goNext}
            hasPrev={nav.hasPrev}
            hasNext={nav.hasNext}
            onTrash={() => {
              void nav.trash()
            }}
            onToggleFavorite={(nextValue) => {
              const cur = nav.selected
              if (cur) void nav.toggleFavorite(cur.id, nextValue)
            }}
            onAddToAlbum={() => setPickerOpen(true)}
            onRemoveFromAlbum={() => {
              void (async () => {
                const cur = nav.selected
                if (!cur) return
                const assetLabel = cur.originalName ?? cur.title ?? 'this asset'
                if (!window.confirm(`Remove "${assetLabel}" from "${album.name}"?`)) return
                await removeAssetFromAlbum(album.id, cur.id)
                await Promise.all([refresh(), refreshAlbum()])
                nav.close()
              })()
            }}
            siblingAssets={assets}
            onSelectSibling={(asset) => nav.open(asset)}
          />
        </Suspense>
      )}

      {showAddDialog && (
        <AddPhotosDialog
          albumName={album.name}
          onClose={() => setShowAddDialog(false)}
          onAdd={async (ids) => {
            await addAssets(ids)
            await refreshAlbum()
          }}
        />
      )}

      {nav.selected && (
        <AlbumPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          assetIds={[nav.selected.id]}
        />
      )}
    </div>
  )
}

interface AddPhotosDialogProps {
  albumName: string
  onClose: () => void
  onAdd: (ids: string[]) => Promise<void>
}

function AddPhotosDialog({ albumName, onClose, onAdd }: AddPhotosDialogProps) {
  const [available, setAvailable] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await listAssets({ limit: 60, isTrashed: false })
        if (cancelled) return
        setAvailable(res.items)
      } catch (err) {
        if (cancelled) return
        setLoadError((err as Error).message ?? 'Failed to load photos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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
      await onAdd(Array.from(selected))
      onClose()
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Failed to add photos')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Add photos to ${albumName}`}
    >
      <div
        className="bg-card-dark rounded-xl shadow-2xl p-6 max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Add photos to {albumName}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <FaXmark className="text-lg" />
          </button>
        </div>

        {submitError && (
          <div className="flex items-center gap-2 text-rose-400 text-sm mb-3 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
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
          ) : available.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mb-3">
                <FaPhotoFilm className="text-xl text-slate-400" />
              </div>
              <p className="text-slate-300 text-sm font-medium">No photos to add</p>
              <p className="text-slate-500 text-xs mt-1 max-w-xs">
                Upload some photos first, then come back here to add them to this album
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {available.map((asset) => {
                const isSelected = selected.has(asset.id)
                return (
                  <div
                    key={asset.id}
                    className="relative aspect-square overflow-hidden rounded-lg bg-card-dark [&>figure]:w-full [&>figure]:h-full"
                  >
                    <GalleryItem asset={asset} onSelect={() => toggle(asset.id)} />
                    {isSelected && (
                      <div className="absolute inset-0 ring-2 ring-primary bg-primary/20 pointer-events-none rounded-lg">
                        <div className="absolute top-1.5 right-1.5 bg-primary rounded-full w-5 h-5 flex items-center justify-center shadow">
                          <FaCheck className="text-white text-[10px]" />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-border-dark">
          <span className="text-xs text-slate-500">
            {selected.size > 0
              ? `${selected.size} ${selected.size === 1 ? 'photo' : 'photos'} selected`
              : 'Select photos to add'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="text-slate-300 hover:text-white text-sm font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
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
              Add {selected.size}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
