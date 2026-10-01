import type { CSSProperties } from 'react'
import type { FaceDto } from '@photox/shared-types'

export interface FaceOverlayProps {
  faces: FaceDto[]
  imageWidth: number
  imageHeight: number
  highlightedFaceId?: string | null
}

export function FaceOverlay({
  faces,
  imageWidth,
  imageHeight,
  highlightedFaceId,
}: FaceOverlayProps) {
  if (imageWidth <= 0 || imageHeight <= 0 || faces.length === 0) return null

  // a stale id (asset changed) must not dim every box with none highlighted
  const highlight = faces.some((face) => face.id === highlightedFaceId) ? highlightedFaceId : null

  return (
    <div
      className="absolute inset-0 pointer-events-none transition-opacity duration-200"
      aria-hidden="true"
    >
      {faces.map((face, i) => {
        const left = (face.box.x / imageWidth) * 100
        const top = (face.box.y / imageHeight) * 100
        const width = (face.box.w / imageWidth) * 100
        const height = (face.box.h / imageHeight) * 100
        const style: CSSProperties = {
          left: `${left}%`,
          top: `${top}%`,
          width: `${width}%`,
          height: `${height}%`,
        }
        const boxClass =
          highlight != null
            ? face.id === highlight
              ? 'border-primary bg-primary/20 z-10 shadow-[0_0_0_2px_rgba(19,109,236,0.45),0_0_18px_rgba(19,109,236,0.55)]'
              : 'border-amber-400/40 bg-amber-400/5 opacity-30'
            : 'border-amber-400/80 bg-amber-400/10 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]'
        return (
          <div
            key={face.id}
            className={`absolute border-2 rounded-md transition duration-150 ${boxClass}`}
            style={style}
          >
            <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-amber-400 text-slate-900 text-[10px] font-bold leading-none tabular-nums">
              {i + 1}
            </span>
          </div>
        )
      })}
    </div>
  )
}
