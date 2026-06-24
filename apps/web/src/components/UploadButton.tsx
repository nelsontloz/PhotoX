import { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import axios from 'axios'
import {
  FaCamera,
  FaSpinner,
  FaCheck,
  FaCircleExclamation,
  FaXmark,
  FaChevronDown,
  FaCloudArrowUp,
  FaCircleCheck,
  FaBroom,
  FaImage,
  FaVideo,
} from 'react-icons/fa6'
import { useUploadStore, type UploadItem } from '../store/upload-store'
import { useThumbStore } from '../store/thumb-store'
import { useAppStore } from '../store/app-store'
import { uploadFile } from '../api/assets'
import { makeThumbnail } from '../lib/clientThumbnail'

const MAX_CONCURRENT = 3

interface UploadButtonProps {
  variant?: 'default' | 'compact'
  onComplete?: () => void
}

export interface UploadButtonHandle {
  open: () => void
}

export const UploadButton = forwardRef<UploadButtonHandle, UploadButtonProps>(function UploadButton(
  { variant = 'default', onComplete },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<Map<string, File>>(new Map())
  const [panelOpen, setPanelOpen] = useState(false)

  const items = useUploadStore((s) => s.items)
  const enqueue = useUploadStore((s) => s.enqueue)
  const setProgress = useUploadStore((s) => s.setProgress)
  const setStatus = useUploadStore((s) => s.setStatus)
  const clearDone = useUploadStore((s) => s.clearDone)
  const thumbSet = useThumbStore((s) => s.set)
  const bumpTimelineRefresh = useAppStore((s) => s.bumpTimelineRefresh)

  const inFlight = items.filter((i) => i.status !== 'done' && i.status !== 'error')
  const doneCount = items.filter((i) => i.status === 'done').length
  const allDone =
    items.length > 0 && items.every((i) => i.status === 'done' || i.status === 'error')

  const open = useCallback(() => inputRef.current?.click(), [])

  useImperativeHandle(ref, () => ({ open }), [])

  const processQueue = useCallback(
    async (ids: string[]) => {
      let idx = 0

      async function worker() {
        while (idx < ids.length) {
          const currentIdx = idx++
          const id = ids[currentIdx]!
          const item = useUploadStore.getState().items.find((i) => i.id === id)
          if (item?.status !== 'queued') continue

          const file = filesRef.current.get(id)
          if (!file) continue

          setStatus(id, 'uploading')

          try {
            const thumbBlob = await makeThumbnail(file)
            if (thumbBlob) {
              const thumbUrl = URL.createObjectURL(thumbBlob)
              thumbSet(id, thumbUrl)
              setStatus(id, 'uploading', { localThumbUrl: thumbUrl })
            }

            const asset = await uploadFile(file, (pct) => setProgress(id, pct), item.kind)
            setStatus(id, 'done', { fileId: asset.fileId, assetId: asset.id })
            filesRef.current.delete(id)
          } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 409) {
              const { existingAssetId, existingFileId } = err.response.data as {
                existingAssetId: string
                existingFileId: string
              }
              setStatus(id, 'done', { fileId: existingFileId, assetId: existingAssetId })
              filesRef.current.delete(id)
              return
            }
            setStatus(id, 'error', {
              error: (err as Error).message ?? 'Upload failed',
            })
            filesRef.current.delete(id)
          }
        }
      }

      const workers = Array.from({ length: MAX_CONCURRENT }, () => worker())
      await Promise.allSettled(workers)
    },
    [setStatus, setProgress, thumbSet],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length === 0) return

      enqueue(files)

      const enqueuedIds = useUploadStore
        .getState()
        .items.slice(-files.length)
        .map((i) => i.id)

      enqueuedIds.forEach((id, i) => {
        filesRef.current.set(id, files[i]!)
      })

      setPanelOpen(true)
      void processQueue(enqueuedIds).then(() => {
        bumpTimelineRefresh()
        onComplete?.()
      })

      if (inputRef.current) inputRef.current.value = ''
    },
    [enqueue, processQueue, bumpTimelineRefresh, onComplete],
  )

  useEffect(() => {
    if (allDone) {
      bumpTimelineRefresh()
      onComplete?.()
    }
  }, [allDone, bumpTimelineRefresh, onComplete])

  if (variant === 'compact') {
    return (
      <>
        <button
          onClick={open}
          className="hidden sm:flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all shadow-lg shadow-primary/20"
        >
          <FaCamera className="text-[14px]" />
          <span>Upload</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleChange}
        />
        {panelOpen && items.length > 0 && (
          <UploadPanel
            items={items}
            inFlight={inFlight}
            doneCount={doneCount}
            allDone={allDone}
            onClose={() => setPanelOpen(false)}
            onDismiss={() => {
              clearDone()
              setPanelOpen(false)
            }}
          />
        )}
      </>
    )
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <button
        onClick={open}
        className="group inline-flex items-center gap-3 bg-primary text-white px-10 py-5 rounded-full font-bold text-lg shadow-2xl shadow-primary/30 hover:scale-105 active:scale-95 transition-transform"
      >
        <FaCamera className="text-2xl group-hover:-translate-y-0.5 transition-transform" />
        <span>Upload Photos</span>
      </button>
      {panelOpen && items.length > 0 && (
        <UploadPanel
          items={items}
          inFlight={inFlight}
          doneCount={doneCount}
          allDone={allDone}
          onClose={() => setPanelOpen(false)}
          onDismiss={() => {
            clearDone()
            setPanelOpen(false)
          }}
        />
      )}
    </>
  )
})

interface UploadPanelProps {
  items: UploadItem[]
  inFlight: UploadItem[]
  doneCount: number
  allDone: boolean
  onClose: () => void
  onDismiss: () => void
}

function UploadPanel({
  items,
  inFlight,
  doneCount,
  allDone,
  onClose,
  onDismiss,
}: UploadPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const thumbGet = useThumbStore((s) => s.get)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const totalProgress =
    items.length > 0 ? Math.round(items.reduce((sum, i) => sum + i.progress, 0) / items.length) : 0

  const errorCount = items.filter((i) => i.status === 'error').length
  const hasDoneItems = doneCount > 0
  const showOverallProgress = inFlight.length > 0 || allDone

  const title =
    inFlight.length > 0
      ? `Uploading ${inFlight.length} of ${items.length} file${items.length > 1 ? 's' : ''}`
      : allDone
        ? errorCount > 0
          ? `${errorCount} of ${items.length} upload${items.length > 1 ? 's' : ''} failed`
          : `All ${items.length} file${items.length > 1 ? 's' : ''} uploaded`
        : `${items.length} file${items.length > 1 ? 's' : ''} queued`

  const subtitle =
    inFlight.length > 0
      ? `${totalProgress}% complete`
      : allDone
        ? errorCount > 0
          ? 'Click an item to retry'
          : 'Click the X to dismiss'
        : 'Preparing to upload'

  const handleClose = () => {
    if (allDone) {
      onDismiss()
    } else {
      onClose()
    }
  }

  return (
    <section
      aria-label="Upload progress"
      className={[
        'fixed z-50',
        'bottom-4 right-4 left-4 sm:left-auto sm:w-80',
        'bg-white/95 dark:bg-card-dark/95 backdrop-blur-md',
        'border border-slate-200 dark:border-border-dark',
        'rounded-xl shadow-2xl shadow-slate-900/10 dark:shadow-black/40',
        'overflow-hidden',
        'transition-all duration-300 ease-out',
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
      ].join(' ')}
    >
      <header className="bg-slate-50/80 dark:bg-footer-dark/80">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls="upload-panel-list"
            className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer rounded"
          >
            <div
              className={[
                'shrink-0 size-8 rounded-full flex items-center justify-center',
                'transition-colors',
                inFlight.length > 0
                  ? 'bg-primary/10 dark:bg-primary/20'
                  : allDone && errorCount === 0
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : allDone
                      ? 'bg-amber-100 dark:bg-amber-900/30'
                      : 'bg-slate-200 dark:bg-slate-700/50',
              ].join(' ')}
            >
              {inFlight.length > 0 ? (
                <FaSpinner className="text-primary text-xs animate-spin" />
              ) : allDone && errorCount === 0 ? (
                <FaCircleCheck className="text-green-600 dark:text-green-400 text-sm" />
              ) : allDone ? (
                <FaCircleExclamation className="text-amber-600 dark:text-amber-400 text-sm" />
              ) : (
                <FaCloudArrowUp className="text-primary text-sm" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p
                aria-live="polite"
                aria-atomic="true"
                className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate"
              >
                {title}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
            </div>
            <FaChevronDown
              className={[
                'shrink-0 text-[10px] text-slate-400 dark:text-slate-500',
                'transition-transform duration-200',
                collapsed ? '-rotate-90' : 'rotate-0',
              ].join(' ')}
              aria-hidden="true"
            />
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            {hasDoneItems && !allDone && (
              <button
                type="button"
                onClick={onDismiss}
                className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
                aria-label="Clear completed uploads"
                title="Clear completed"
              >
                <FaBroom className="text-xs" />
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
              aria-label={allDone ? 'Dismiss upload panel' : 'Close upload panel'}
              title={allDone ? 'Dismiss' : 'Close'}
            >
              <FaXmark className="text-xs" />
            </button>
          </div>
        </div>
        {showOverallProgress && (
          <div
            className="h-0.5 bg-slate-200 dark:bg-slate-700/50 overflow-hidden"
            role="progressbar"
            aria-valuenow={allDone ? 100 : totalProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Overall upload progress"
          >
            <div
              className={[
                'h-full transition-all duration-500 ease-out',
                allDone ? (errorCount > 0 ? 'bg-amber-500' : 'bg-green-500') : 'bg-primary',
              ].join(' ')}
              style={{ width: `${allDone ? 100 : totalProgress}%` }}
            />
          </div>
        )}
      </header>

      {!collapsed && (
        <ul
          id="upload-panel-list"
          className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60"
        >
          {items.map((item) => {
            const thumbUrl = item.localThumbUrl ?? thumbGet(item.id)
            const isError = item.status === 'error'
            const isDone = item.status === 'done'
            const isUploading = item.status === 'uploading'
            return (
              <li
                key={item.id}
                className={[
                  'flex items-center gap-3 px-3 py-2.5',
                  'transition-colors',
                  isError ? 'bg-red-50/60 dark:bg-red-950/20' : '',
                ].join(' ')}
              >
                <div
                  className={[
                    'w-10 h-10 rounded-md overflow-hidden shrink-0 flex items-center justify-center',
                    'bg-slate-100 dark:bg-slate-800/60',
                    isError ? 'ring-1 ring-red-200/60 dark:ring-red-900/40' : '',
                  ].join(' ')}
                >
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                  ) : item.kind === 'video' ? (
                    <FaVideo className="text-base text-slate-400 dark:text-slate-500" />
                  ) : (
                    <FaImage className="text-base text-slate-400 dark:text-slate-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={[
                      'text-xs truncate',
                      isError
                        ? 'text-red-700 dark:text-red-300'
                        : 'text-slate-700 dark:text-slate-200',
                    ].join(' ')}
                  >
                    {item.fileName}
                  </p>
                  {isError ? (
                    <button
                      type="button"
                      onClick={() => {
                        /* retry not yet wired */
                      }}
                      className="text-[10px] text-red-600 dark:text-red-400 hover:underline truncate max-w-full text-left inline-flex items-center gap-1"
                      title="Click to retry"
                    >
                      <span className="truncate">{item.error ?? 'Upload failed'}</span>
                      <span className="shrink-0">· Click to retry</span>
                    </button>
                  ) : isDone ? (
                    <p className="text-[10px] text-green-600 dark:text-green-400 inline-flex items-center gap-1">
                      <FaCheck className="text-[8px]" />
                      <span>Uploaded</span>
                    </p>
                  ) : isUploading ? (
                    <div className="mt-1 h-1 bg-slate-200 dark:bg-slate-700/50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Waiting...</p>
                  )}
                </div>
                <div className="shrink-0 w-10 text-right">
                  {isDone && <FaCheck className="text-green-500 text-xs ml-auto" />}
                  {isError && <FaCircleExclamation className="text-red-500 text-xs ml-auto" />}
                  {isUploading && (
                    <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                      {item.progress}%
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
