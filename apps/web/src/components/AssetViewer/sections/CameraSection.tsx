import type { Asset } from '@photox/shared-types'

interface CameraSectionProps {
  asset: Asset
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-tight">{label}</p>
      <p className="text-xs text-slate-200 font-medium">{value ?? 'Not extracted yet'}</p>
    </div>
  )
}

export function CameraSection({ asset }: CameraSectionProps) {
  const camera = [asset.cameraMake, asset.cameraModel].filter(Boolean).join(' ') || null

  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
        Camera Info
      </h4>
      <div className="grid grid-cols-2 gap-y-4 gap-x-2">
        <InfoRow label="Camera" value={camera} />
        <InfoRow label="Lens" value={null} />
        <InfoRow label="Aperture" value={null} />
        <InfoRow label="Shutter" value={null} />
        <InfoRow label="ISO" value={null} />
        <InfoRow label="Focal Length" value={null} />
      </div>
    </section>
  )
}
