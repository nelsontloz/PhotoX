import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  FaArrowLeft,
  FaCheck,
  FaCircleExclamation,
  FaEllipsisVertical,
  FaPenToSquare,
  FaPhotoFilm,
  FaPlus,
  FaShare,
  FaTrash,
} from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { useConfirm } from '../../components/ConfirmProvider'
import { LoadingState } from '../../components/StateViews'
import { ViewerHost } from '../../components/ViewerHost'
import { GalleryItem } from '../../components/GalleryItem'
import { getAlbum, removeAssetFromAlbum } from '../../api/albums'
import { createShare, getShareUrl } from '../../api/shares'
import { useAlbumAssets } from '../../hooks/useAlbumAssets'
import { useAlbums } from '../../hooks/useAlbums'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { useInlineRename } from '../../hooks/useInlineRename'
import { AddPhotosDialog } from './AddPhotosDialog'
import type { AlbumDto } from '@photox/shared-types'

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
  const confirm = useConfirm()
  const [album, setAlbum] = useState<AlbumDto | null>(null)
  const [loadingAlbum, setLoadingAlbum] = useState(true)
  const [albumNotFound, setAlbumNotFound] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [shareStatus, setShareStatus] = useState<'copied' | 'error' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const { update, remove } = useAlbums()
  const {
    editing: editingName,
    nameValue,
    setNameValue,
    start,
    save,
    cancel,
  } = useInlineRename(album?.name ?? '', async (name) => {
    if (!id) return
    const updated = await update(id, { name })
    setAlbum(updated)
  })
  const {
    assets,
    total,
    loading: loadingAssets,
    error: assetsError,
    refresh,
    addAssets,
  } = useAlbumAssets(id ?? '')

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

  const handleShare = () => {
    if (!id) return
    setShowMenu(false)
    void (async () => {
      try {
        const share = await createShare({ albumId: id })
        await navigator.clipboard.writeText(getShareUrl(share.token))
        setShareStatus('copied')
      } catch {
        setShareStatus('error')
      }
      setTimeout(() => setShareStatus(null), 2000)
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
    return <LoadingState className="flex justify-center py-20" />
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
              void save()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') cancel()
            }}
            className="text-2xl font-bold text-white bg-transparent border-b border-primary outline-none flex-1 min-w-[12rem] py-1"
          />
        ) : (
          <h1
            onClick={() => {
              start()
              setShowMenu(false)
            }}
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
          {shareStatus && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                shareStatus === 'copied' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {shareStatus === 'copied' ? <FaCheck /> : <FaCircleExclamation />}
              {shareStatus === 'copied' ? 'Link copied' : 'Could not copy link'}
            </span>
          )}
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
                  onClick={() => {
                    start()
                    setShowMenu(false)
                  }}
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
                <button
                  onClick={handleShare}
                  className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-white/5 inline-flex items-center gap-2"
                >
                  <FaShare className="text-xs" />
                  Share album
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

      <ViewerHost
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
            if (!(await confirm({ title: `Remove "${assetLabel}" from "${album.name}"?` }))) return
            await removeAssetFromAlbum(album.id, cur.id)
            await Promise.all([refresh(), refreshAlbum()])
            nav.close()
          })()
        }}
        siblingAssets={assets}
        onSelectSibling={(asset) => nav.open(asset)}
        pickerOpen={pickerOpen}
        onPickerClose={() => setPickerOpen(false)}
      />

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
    </div>
  )
}
