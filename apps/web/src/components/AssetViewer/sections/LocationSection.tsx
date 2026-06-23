import { FaLocationDot } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'

interface LocationSectionProps {
  asset: Asset
}

function formatCoord(value: number, positive: string, negative: string): string {
  const abs = Math.abs(value)
  return `${abs.toFixed(4)}° ${value >= 0 ? positive : negative}`
}

export function LocationSection({ asset }: LocationSectionProps) {
  const hasCoords = asset.latitude != null && asset.longitude != null

  if (!hasCoords) {
    return (
      <section>
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
          Location
        </h4>
        <p className="text-sm text-slate-600 italic">No location data</p>
      </section>
    )
  }

  const lat = formatCoord(asset.latitude!, 'N', 'S')
  const lng = formatCoord(asset.longitude!, 'E', 'W')
  const mapUrl = `https://www.openstreetmap.org/?mlat=${asset.latitude}&mlon=${asset.longitude}&zoom=15`

  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
        Location
      </h4>
      <a
        href={mapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-3 rounded-lg border border-border-dark hover:bg-card-dark transition-colors group"
      >
        <FaLocationDot className="text-primary text-xl shrink-0" />
        <div>
          <p className="text-xs text-slate-200 font-medium">
            {lat}, {lng}
          </p>
          <p className="text-[10px] text-slate-500 group-hover:text-primary transition-colors">
            Open in OpenStreetMap
          </p>
        </div>
      </a>
    </section>
  )
}
