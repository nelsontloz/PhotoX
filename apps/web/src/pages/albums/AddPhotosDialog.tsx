import { useCallback, useRef, useState } from 'react'
import { FaCircleExclamation, FaPhotoFilm, FaPlus, FaSpinner } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { ScrollContainerContext } from '../../components/AppShell'
import { Dialog } from '../../components/Dialog'
import { TimelineGrid } from '../../components/Timeline/TimelineGrid'
import { useTimelineLayout } from '../../hooks/useTimelineLayout'
import { useTimelineMonths } from '../../hooks/useTimelineMonths'

interface AddPhotosDialogProps {
  albumName: string
  onClose: () => void
  onAdd: (ids: string[]) => Promise<void>
}

export function AddPhotosDialog({ albumName, onClose, onAdd }: AddPhotosDialogProps) {
  // Same pipeline as the home timeline: the full-library layout reserves every bucket/day height
  // up front, then months fill in lazily behind it — skeletons sit in the exact slots, no shift.
  const timeline = useTimelineLayout()
  const { groups, monthStatus, ensureMonth, retainMonths, refreshKey } = useTimelineMonths()
  // The dialog's own scroller — inside a position:fixed panel everything must scroll against
  // this, not AppShell's <main>: the grid's windowing, AssetThumb's observers AND the
  // TimelineScrollbar rail (which anchors to this box) all key off the ScrollContainerContext
  // override below.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Click always toggles: the modal has no viewer, so there is no open-vs-select mode.
  const onSelect = useCallback((asset: Asset) => toggle(asset.id), [toggle])

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
      panelClassName="bg-card-dark rounded-xl shadow-2xl p-6 max-w-6xl w-full max-h-[80vh] flex flex-col"
      closeClassName="text-slate-400 hover:text-white transition-colors p-1"
      ariaLabel={`Add photos to ${albumName}`}
    >
      {submitError && (
        <div className="flex items-center gap-2 text-rose-400 text-sm mb-3 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
          <FaCircleExclamation />
          <span>{submitError}</span>
        </div>
      )}

      {/* px-4 sm:px-8 mirrors AppShell's <main>: TimelineGrid's sticky day headers bleed out by
          exactly those negative margins, so the bands run edge-to-edge with the scroller. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6">
        {/* Override the scroll root for the fixed panel: TimelineGrid windows months, AssetThumb
            roots its IntersectionObserver, and the chronological rail measures its box against
            the scroll container. Against AppShell's <main> none of that works — a fixed descendant
            never intersects that root, so thumbs would stay skeletons forever (the old grid papered
            over it with `eager`). */}
        <ScrollContainerContext.Provider value={scrollRef}>
          {timeline.error ? (
            <div className="flex items-center justify-center gap-2 text-rose-400 text-sm py-12">
              <FaCircleExclamation />
              <span>{timeline.error}</span>
            </div>
          ) : timeline.loading ? (
            <div className="flex justify-center py-16">
              <FaSpinner className="text-primary text-2xl animate-spin" />
            </div>
          ) : timeline.layout.buckets.length === 0 ? (
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
            <TimelineGrid
              layout={timeline.layout}
              containerRef={timeline.containerRef}
              groups={groups}
              monthStatus={monthStatus}
              ensureMonth={ensureMonth}
              retainMonths={retainMonths}
              refreshKey={refreshKey}
              // sticky day bands blend with this panel instead of the page background
              dayHeaderSurfaceClassName="bg-card-dark/95 text-white"
              onSelect={onSelect}
              selectedIds={selected}
              onToggleSelect={toggle}
            />
          )}
        </ScrollContainerContext.Provider>
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
