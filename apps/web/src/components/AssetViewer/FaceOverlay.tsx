import type { CSSProperties } from 'react'

export interface Face {
  id: string
  box: { x: number; y: number; w: number; h: number }
  confidence: number
}

function isFace(v: unknown): v is Face {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  const box = f.box
  if (typeof box !== 'object' || box === null) return false
  const b = box as Record<string, unknown>
  return (
    typeof f.id === 'string' &&
    typeof f.confidence === 'number' &&
    Number.isFinite(f.confidence) &&
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.w === 'number' &&
    typeof b.h === 'number' &&
    b.w > 0 &&
    b.h > 0
  )
}

export function parseFaces(metadata: Record<string, unknown> | null): Face[] {
  if (!metadata) return []
  const raw = metadata.faces
  if (!Array.isArray(raw)) return []
  return raw.filter(isFace)
}

export interface FaceOverlayProps {
  faces: Face[]
  imageWidth: number
  imageHeight: number
}

export function FaceOverlay({ faces, imageWidth, imageHeight }: FaceOverlayProps) {
  if (imageWidth <= 0 || imageHeight <= 0 || faces.length === 0) return null

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
        return (
          <div
            key={face.id}
            className="absolute border-2 border-amber-400/80 bg-amber-400/10 rounded-md shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
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
