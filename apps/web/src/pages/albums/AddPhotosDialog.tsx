import { useEffect, useState } from 'react'
import { FaCheck, FaCircleExclamation, FaPhotoFilm, FaPlus, FaSpinner } from 'react-icons/fa6'
import { GalleryItem } from '../../components/GalleryItem'
import { Dialog } from '../../components/Dialog'
import { listAssets } from '../../api/assets'
import type { Asset } from '@photox/shared-types'

interface AddPhotosDialogProps {
  albumName: string
  onClose: () => void
  onAdd: (ids: string[]) => Promise<void>
}

export function AddPhotosDialog({ albumName, onClose, onAdd }: AddPhotosDialogProps) {
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
    <Dialog
      title={`Add photos to ${albumName}`}
      onClose={onClose}
      panelClassName="bg-card-dark rounded-xl shadow-2xl p-6 max-w-3xl w-full max-h-[80vh] flex flex-col"
      closeClassName="text-slate-400 hover:text-white transition-colors p-1"
      ariaLabel={`Add photos to ${albumName}`}
    >
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
                  <GalleryItem asset={asset} eager onSelect={() => toggle(asset.id)} />
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
    </Dialog>
  )
}
