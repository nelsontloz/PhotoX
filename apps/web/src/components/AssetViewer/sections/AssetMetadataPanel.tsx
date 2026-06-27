import { FaCircleCheck, FaCircleInfo, FaCircleXmark, FaSpinner } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { formatBytes, formatDuration } from '../../../lib/format'

export interface AssetMetadataPanelProps {
  asset: Asset
}

function formatFps(fps: number | null): string | null {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) return null
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`
}

function transcodeLabel(
  status: Asset['transcodeStatus'],
): { text: string; tone: 'ok' | 'pending' | 'failed' } | null {
  if (status === 'ready') {
    return { text: 'Ready', tone: 'ok' }
  }
  if (status === 'pending') {
    return { text: 'Transcoding', tone: 'pending' }
  }
  if (status === 'failed') {
    return { text: 'Failed', tone: 'failed' }
  }
  return null
}

export function AssetMetadataPanel({ asset }: AssetMetadataPanelProps) {
  const isVideo = asset.kind === 'video'

  const duration = formatDuration(asset.durationSeconds)
  const size = formatBytes(asset.sizeBytes)
  const fps = formatFps(asset.fps)
  const resolution =
    asset.width != null && asset.height != null ? `${asset.width} × ${asset.height}` : null
  const codec = asset.codec ?? null
  const hasAudio = asset.hasAudio === null ? null : asset.hasAudio ? 'Yes' : 'No'
  const streaming = isVideo ? transcodeLabel(asset.transcodeStatus) : null

  const photoRows = [
    { label: 'Resolution', value: resolution },
    { label: 'File size', value: size },
    { label: 'Type', value: asset.mimeType },
  ].filter((r) => r.value != null)

  const videoRows = [
    { label: 'Duration', value: duration },
    { label: 'Streaming', value: streaming },
    { label: 'Codec', value: codec },
    { label: 'Resolution', value: resolution },
    { label: 'Frame rate', value: fps },
    { label: 'Audio', value: hasAudio },
    { label: 'File size', value: size },
    { label: 'MIME type', value: asset.mimeType },
  ].filter((r) => r.value != null)

  const rows = isVideo ? videoRows : photoRows

  if (rows.length === 0) {
    return (
      <section>
        <div className="flex items-center gap-2 text-slate-400 mb-2">
          <FaCircleInfo className="text-[18px]" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Details</h4>
        </div>
        <p className="text-sm text-slate-600 italic">No technical details available</p>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center gap-2 text-slate-400 mb-3">
        <FaCircleInfo className="text-[18px]" />
        <h4 className="text-xs font-bold uppercase tracking-wider">Details</h4>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">
              {row.label}
            </dt>
            <dd className="text-slate-200 font-medium tabular-nums truncate">
              {row.value && typeof row.value === 'object' ? (
                <span className="inline-flex items-center gap-1.5">
                  {row.value.tone === 'ok' && (
                    <FaCircleCheck className="text-green-500 dark:text-green-400 text-xs" />
                  )}
                  {row.value.tone === 'pending' && (
                    <FaSpinner className="text-primary text-xs animate-spin" />
                  )}
                  {row.value.tone === 'failed' && (
                    <FaCircleXmark className="text-red-500 dark:text-red-400 text-xs" />
                  )}
                  {row.value.text}
                </span>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
