import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { create } from 'zustand'
import { FaArrowUp, FaChevronDown, FaCloudArrowUp } from 'react-icons/fa6'
import { useUploadStore, type UploadItem, type UploadStatus } from '../store/upload-store'
import { formatBytes } from '../lib/format'
import { UploadListItem } from './UploadListItem'

const STATUS_ORDER: Record<UploadStatus, number> = {
  uploading: 0,
  queued: 1,
  error: 2,
  done: 3,
}

const RING_PATH = 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831'

// Overlay state for the below-lg queue (the rail widget opens it). Pure UI, never persisted; it
// resets itself whenever the queue empties or is dismissed.
const useQueueOverlay = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

// The mockup's "Cancel all" cannot abort uploads (no abort support): settled queues clear, live
// queues just hide the UI.
function dismissUploads(): void {
  const state = useUploadStore.getState()
  const settled = state.items.every((i) => i.status === 'done' || i.status === 'error')
  if (settled) state.clearDone()
  state.setDismissed(true)
}

/** Done counts as 100%: a 409 dedupe finishes without ever ticking progress. */
function effectiveProgress(item: UploadItem): number {
  const pct = item.status === 'done' ? 100 : item.progress
  return Math.min(100, Math.max(0, pct))
}

interface UploadSummary {
  total: number
  doneCount: number
  errorCount: number
  inFlight: number
  overallPct: number
  uploadedBytes: number
  totalBytes: number
  /** Everything finished cleanly — the rings switch to emerald. */
  allDone: boolean
  title: string
  sorted: UploadItem[]
}

function useUploadSummary(): UploadSummary | null {
  const items = useUploadStore((s) => s.items)
  const dismissed = useUploadStore((s) => s.dismissed)
  if (items.length === 0 || dismissed) return null

  const total = items.length
  const doneCount = items.filter((i) => i.status === 'done').length
  const errorCount = items.filter((i) => i.status === 'error').length
  const inFlight = items.filter((i) => i.status === 'uploading' || i.status === 'queued').length
  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0)
  const uploadedBytes = items.reduce(
    (sum, i) => sum + (i.sizeBytes * effectiveProgress(i)) / 100,
    0,
  )
  const overallPct =
    totalBytes > 0
      ? (uploadedBytes / totalBytes) * 100
      : items.reduce((sum, i) => sum + effectiveProgress(i), 0) / total

  let title: string
  if (inFlight === 0 && errorCount === 0) title = `All ${total} files uploaded`
  else if (inFlight === 0) title = `${errorCount} uploads failed`
  else if (items.some((i) => i.status === 'uploading')) title = `Uploading ${inFlight} files`
  else title = `${inFlight} files queued`

  const sorted = [...items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

  return {
    total,
    doneCount,
    errorCount,
    inFlight,
    overallPct,
    uploadedBytes,
    totalBytes,
    allDone: inFlight === 0 && errorCount === 0,
    title,
    sorted,
  }
}

function ProgressRing({
  pct,
  className = 'size-5',
  complete = false,
  children,
}: {
  pct: number
  className?: string
  /** All uploads finished: swap the arc from primary to emerald. */
  complete?: boolean
  children: ReactNode
}) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div className={`relative ${className} flex items-center justify-center shrink-0`}>
      <svg className="size-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
        <path
          className="text-slate-200 dark:text-border-dark"
          strokeWidth={3.5}
          stroke="currentColor"
          fill="none"
          d={RING_PATH}
        />
        <path
          className={`${complete ? 'text-emerald-500' : 'text-primary'} transition-all duration-300 ease-out ${clamped > 0 ? '' : 'opacity-0'}`}
          strokeDasharray="100, 100"
          strokeDashoffset={100 - clamped}
          strokeWidth={3.5}
          strokeLinecap="round"
          stroke="currentColor"
          fill="none"
          d={RING_PATH}
        />
      </svg>
      <span className="absolute flex items-center justify-center">{children}</span>
    </div>
  )
}

function UploadQueueBody() {
  const summary = useUploadSummary()
  const [collapsed, setCollapsed] = useState(false)
  if (!summary) return null

  const settled = summary.inFlight === 0
  const clampedPct = Math.min(100, Math.max(0, Math.round(summary.overallPct)))

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ProgressRing pct={summary.overallPct} complete={summary.allDone}>
            <FaCloudArrowUp className="text-[10px] text-primary" />
          </ProgressRing>
          <span
            aria-live="polite"
            aria-atomic="true"
            className="text-xs font-semibold text-slate-900 dark:text-white truncate"
          >
            {summary.title}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand upload queue' : 'Collapse upload queue'}
          className="p-1 -m-1 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-card-dark transition-colors shrink-0"
        >
          <FaChevronDown
            className={`text-[10px] transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="w-full bg-slate-200 dark:bg-border-dark h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${clampedPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
            <span>
              {summary.doneCount} of {summary.total} completed
            </span>
            <span className="tabular-nums">
              {formatBytes(summary.uploadedBytes) ?? '0 B'} /{' '}
              {formatBytes(summary.totalBytes) ?? '0 B'}
            </span>
          </div>

          <ul className="upload-queue-scroll flex flex-col gap-1.5 overflow-y-auto max-h-56">
            {summary.sorted.map((item) => (
              <UploadListItem key={item.id} item={item} />
            ))}
          </ul>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={dismissUploads}
              className="px-2 py-1 -mb-0.5 -mr-0.5 rounded-lg text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-card-dark transition-colors"
            >
              {settled ? 'Clear' : 'Hide'}
            </button>
          </div>
        </>
      )}
    </>
  )
}

/**
 * Sidebar upload UI: the compact ring in the 50px rail below lg, the bottom-pinned queue card at
 * lg+. The rail opens the overlay so the detailed list stays reachable on narrow screens.
 */
export function UploadSidebarQueue() {
  const summary = useUploadSummary()
  const setOpen = useQueueOverlay((s) => s.setOpen)
  if (!summary) return null

  const pct = Math.round(summary.overallPct)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Upload progress: ${pct}%. Open upload queue`}
        className="lg:hidden mx-1 mb-2 p-1 flex flex-col items-center gap-1 rounded-lg bg-slate-100 dark:bg-surface-container-low border border-gray-200 dark:border-border-dark shadow-sm hover:bg-slate-200 dark:hover:bg-card-dark transition-colors cursor-pointer animate-upload-rise motion-reduce:animate-none"
      >
        <ProgressRing pct={summary.overallPct} className="size-7" complete={summary.allDone}>
          <FaArrowUp className="text-[9px] text-primary" />
        </ProgressRing>
        <span className="text-[9px] font-bold text-slate-900 dark:text-white tabular-nums">
          {pct}%
        </span>
      </button>

      <div className="hidden lg:flex flex-col gap-2.5 mx-3 mb-2 p-2.5 rounded-xl bg-slate-100 dark:bg-surface-container-low border border-gray-200 dark:border-border-dark shadow-sm animate-upload-rise motion-reduce:animate-none">
        <UploadQueueBody />
      </div>
    </>
  )
}

/** Below-lg detail view: the same queue body as the sidebar card, as a lightweight fixed overlay. */
export function UploadOverlay() {
  const summary = useUploadSummary()
  const open = useQueueOverlay((s) => s.open)
  const setOpen = useQueueOverlay((s) => s.setOpen)
  const visible = summary !== null

  useEffect(() => {
    if (!visible) setOpen(false)
  }, [visible, setOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open || !summary) return null

  return (
    <div
      role="presentation"
      onClick={() => setOpen(false)}
      className="lg:hidden fixed inset-0 z-50 flex items-end bg-black/40 p-3 pb-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload progress"
        onClick={(e) => e.stopPropagation()}
        className="w-full flex flex-col gap-2.5 p-3 rounded-2xl bg-slate-100 dark:bg-surface-container-low border border-gray-200 dark:border-border-dark shadow-2xl animate-upload-rise motion-reduce:animate-none"
      >
        <UploadQueueBody />
      </div>
    </div>
  )
}
