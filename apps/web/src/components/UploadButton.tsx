import { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import axios from 'axios'
import {
  FaCamera,
  FaSpinner,
  FaCheck,
  FaCircleExclamation,
  FaXmark,
  FaChevronUp,
  FaChevronDown,
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
  const thumbGet = useThumbStore((s) => s.get)

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-[#1d1f27] border border-[#424754]/30 rounded-xl shadow-2xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-[#272a32] cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          {inFlight.length > 0 ? (
            <FaSpinner className="text-primary animate-spin text-sm" />
          ) : allDone ? (
            <FaCheck className="text-green-400 text-sm" />
          ) : null}
          <span className="text-sm font-semibold text-white">
            {inFlight.length > 0
              ? `Uploading ${inFlight.length} file${inFlight.length > 1 ? 's' : ''}...`
              : allDone
                ? `Done (${doneCount}/${items.length})`
                : `${items.length} file${items.length > 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (allDone) {
                onDismiss()
              } else {
                onClose()
              }
            }}
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            {allDone ? (
              <FaXmark className="text-xs" />
            ) : collapsed ? (
              <FaChevronUp className="text-xs" />
            ) : (
              <FaChevronDown className="text-xs" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-60 overflow-y-auto">
          {items.map((item) => {
            const thumbUrl = item.localThumbUrl ?? thumbGet(item.id)
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-2 border-t border-[#424754]/10"
              >
                <div className="w-8 h-8 rounded bg-[#32353d] overflow-hidden shrink-0 flex items-center justify-center">
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <FaCamera className="text-xs text-slate-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{item.fileName}</p>
                  {item.status === 'error' ? (
                    <p className="text-[10px] text-red-400 truncate">{item.error}</p>
                  ) : item.status === 'done' ? (
                    <p className="text-[10px] text-green-400">Uploaded</p>
                  ) : item.status === 'uploading' ? (
                    <div className="mt-1 h-1 bg-[#424754] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500">Waiting...</p>
                  )}
                </div>
                <div className="shrink-0">
                  {item.status === 'done' && <FaCheck className="text-green-400 text-xs" />}
                  {item.status === 'error' && (
                    <FaCircleExclamation className="text-red-400 text-xs" />
                  )}
                  {item.status === 'uploading' && (
                    <span className="text-[10px] text-slate-400">{item.progress}%</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
