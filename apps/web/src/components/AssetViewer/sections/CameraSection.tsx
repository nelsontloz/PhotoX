import { FaCamera } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'

interface CameraSectionProps {
  asset: Asset
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed
}

function trimNum(value: number, decimals: number): string {
  return String(parseFloat(value.toFixed(decimals)))
}

function formatShutter(seconds: number): string {
  const reciprocal = Math.round(1 / seconds)
  if (seconds < 1 && reciprocal >= 10) return `1/${reciprocal} s`
  return `${trimNum(seconds, 3)} s`
}

function formatCamera(make: string | null, model: string | null): string | null {
  if (!model) return make
  if (!make || model.toLowerCase().startsWith(make.toLowerCase())) return model
  return `${make} ${model}`
}

export function CameraSection({ asset }: CameraSectionProps) {
  const rows: { label: string; value: string | null; wide?: boolean }[] = [
    {
      label: 'Camera',
      value: formatCamera(emptyToNull(asset.cameraMake), emptyToNull(asset.cameraModel)),
      wide: true,
    },
    { label: 'Lens', value: emptyToNull(asset.lensModel), wide: true },
    {
      label: 'Focal length',
      value:
        asset.focalLength != null && asset.focalLength > 0
          ? `${trimNum(asset.focalLength, 1)} mm`
          : null,
    },
    {
      label: 'Aperture',
      value: asset.fNumber != null && asset.fNumber > 0 ? `ƒ/${trimNum(asset.fNumber, 2)}` : null,
    },
    {
      label: 'Shutter',
      value:
        asset.exposureTime != null && asset.exposureTime > 0
          ? formatShutter(asset.exposureTime)
          : null,
    },
    { label: 'ISO', value: asset.iso != null && asset.iso > 0 ? String(asset.iso) : null },
  ].filter((row) => row.value != null)

  if (rows.length === 0) {
    return (
      <section>
        <div className="flex items-center gap-2 text-slate-400 mb-2">
          <FaCamera className="text-[18px]" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Camera</h4>
        </div>
        <p className="text-sm text-slate-600 italic">No camera details</p>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center gap-2 text-slate-400 mb-3">
        <FaCamera className="text-[18px]" />
        <h4 className="text-xs font-bold uppercase tracking-wider">Camera</h4>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className={`flex flex-col${row.wide ? ' col-span-2' : ''}`}>
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">{row.label}</dt>
            <dd className="text-slate-200 font-medium tabular-nums truncate">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
