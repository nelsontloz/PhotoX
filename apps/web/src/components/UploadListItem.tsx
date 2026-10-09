import { FaCheck, FaImage, FaVideo } from 'react-icons/fa6'
import type { UploadItem } from '../store/upload-store'

/** Compact queue row: thumbnail or kind chip, filename, status. No per-file progress bar. */
export function UploadListItem({ item }: { item: UploadItem }) {
  const isUploading = item.status === 'uploading'
  const isDone = item.status === 'done'
  const isError = item.status === 'error'

  return (
    <li className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/60 dark:bg-surface-container-high/60 border border-gray-200 dark:border-border-dark/70">
      {item.localThumbUrl ? (
        <img src={item.localThumbUrl} alt="" className="size-5 rounded object-cover shrink-0" />
      ) : (
        <span
          className={`size-5 rounded flex items-center justify-center shrink-0 ${
            isDone ? 'bg-emerald-500/15 text-emerald-500' : 'bg-primary/10 text-primary'
          }`}
        >
          {isDone ? (
            <FaCheck className="text-[9px]" />
          ) : item.kind === 'video' ? (
            <FaVideo className="text-[9px]" />
          ) : (
            <FaImage className="text-[9px]" />
          )}
        </span>
      )}
      <span className="flex-1 min-w-0 text-[11px] text-slate-700 dark:text-slate-300 truncate">
        {item.fileName}
      </span>
      <span
        className={`text-[10px] font-semibold tabular-nums shrink-0 ${
          isUploading
            ? 'text-primary'
            : isDone
              ? 'text-emerald-500'
              : isError
                ? 'text-red-500 dark:text-red-400'
                : 'text-slate-400 dark:text-slate-500'
        }`}
      >
        {isUploading ? `${item.progress}%` : isDone ? 'Done' : isError ? 'Failed' : 'Queued'}
      </span>
    </li>
  )
}
