import { FaImage, FaVideo } from 'react-icons/fa6'
import type { UploadItem } from '../store/upload-store'

interface UploadListItemProps {
  item: UploadItem
  thumbUrl: string | undefined
}

export function UploadListItem({ item, thumbUrl }: UploadListItemProps) {
  const isError = item.status === 'error'
  const isDone = item.status === 'done'
  const isUploading = item.status === 'uploading'

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="size-8 rounded overflow-hidden shrink-0 flex items-center justify-center bg-slate-800">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
        ) : item.kind === 'video' ? (
          <FaVideo className="text-sm text-slate-500" />
        ) : (
          <FaImage className="text-sm text-slate-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <span className="text-xs font-medium text-slate-300 truncate">{item.fileName}</span>
          <span className="text-[10px] font-medium text-primary tabular-nums shrink-0 ml-2">
            {isUploading ? `${item.progress}%` : isDone ? 'Done' : isError ? 'Failed' : 'Queued'}
          </span>
        </div>
        <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={[
              'h-full rounded-full transition-all duration-300 ease-out',
              isDone ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-primary',
            ].join(' ')}
            style={{
              width: isDone ? '100%' : isError ? '0%' : `${item.progress}%`,
            }}
          />
        </div>
      </div>
    </li>
  )
}
