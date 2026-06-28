import { useState, useEffect } from 'react'
import {
  FaWindowMinimize,
  FaXmark,
  FaCircleCheck,
  FaCircleExclamation,
  FaCloudArrowUp,
} from 'react-icons/fa6'
import { useUploadStore, type UploadStatus } from '../store/upload-store'
import { useThumbStore } from '../store/thumb-store'
import { UploadListItem } from './UploadListItem'
import { formatBytes } from '../lib/format'

const STATUS_ORDER: Record<UploadStatus, number> = {
  uploading: 0,
  queued: 1,
  error: 2,
  done: 3,
}

export function UploadNotification() {
  const items = useUploadStore((s) => s.items)
  const dismissed = useUploadStore((s) => s.dismissed)
  const setDismissed = useUploadStore((s) => s.setDismissed)
  const thumbGet = useThumbStore((s) => s.get)

  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  if (items.length === 0 || dismissed) return null

  const inFlight = items.filter((i) => i.status !== 'done' && i.status !== 'error')
  const errorCount = items.filter((i) => i.status === 'error').length
  const allDone =
    items.length > 0 && items.every((i) => i.status === 'done' || i.status === 'error')
  const uploadingCount = items.filter((i) => i.status === 'uploading').length
  const bytesUploaded = items.reduce((sum, i) => sum + (i.sizeBytes * i.progress) / 100, 0)
  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0)

  let title: string
  let icon: React.ReactNode

  if (allDone && errorCount === 0) {
    title = `All ${items.length} items uploaded`
    icon = <FaCircleCheck className="text-green-500" />
  } else if (allDone) {
    title = `${errorCount} uploads failed`
    icon = <FaCircleExclamation className="text-amber-500" />
  } else if (uploadingCount > 0) {
    title = `Uploading ${inFlight.length} items`
    icon = (
      <span className="relative flex size-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex rounded-full size-2 bg-primary" />
      </span>
    )
  } else {
    title = `${items.length} items queued`
    icon = <FaCloudArrowUp className="text-primary" />
  }

  const handleClose = () => {
    if (allDone) {
      useUploadStore.getState().clearDone()
      setDismissed(false)
    } else {
      setDismissed(true)
    }
  }

  return (
    <section
      aria-label="Upload progress"
      className={[
        'fixed z-50',
        'bottom-6 right-6 w-80',
        'bg-card-dark',
        'border border-border-dark',
        'rounded-xl shadow-2xl',
        'overflow-hidden',
        'transition-all duration-300 ease-out',
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
      ].join(' ')}
    >
      <header className="bg-slate-900/50">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer rounded"
          >
            <div className="shrink-0 size-6 flex items-center justify-center">{icon}</div>
            <p
              aria-live="polite"
              aria-atomic="true"
              className="text-xs font-semibold text-slate-100 truncate"
            >
              {title}
            </p>
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
              aria-label={collapsed ? 'Expand upload list' : 'Minimize upload list'}
            >
              <FaWindowMinimize className="text-[10px]" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
              aria-label={allDone ? 'Dismiss upload panel' : 'Close upload panel'}
            >
              <FaXmark className="text-xs" />
            </button>
          </div>
        </div>
      </header>

      {!collapsed && (
        <>
          <ul className="upload-queue-scroll max-h-72 overflow-y-auto divide-y divide-border-dark">
            {[...items]
              .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
              .map((item) => (
                <UploadListItem
                  key={item.id}
                  item={item}
                  thumbUrl={item.localThumbUrl ?? thumbGet(item.id)}
                />
              ))}
          </ul>

          <div className="px-4 py-2 border-t border-border-dark bg-slate-900/30 text-center">
            <span className="text-[10px] font-medium text-slate-500">
              {formatBytes(bytesUploaded)} of {formatBytes(totalBytes)} uploaded
            </span>
          </div>
        </>
      )}
    </section>
  )
}
