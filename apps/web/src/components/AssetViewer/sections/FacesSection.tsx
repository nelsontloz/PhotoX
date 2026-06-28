import { FaSpinner, FaTriangleExclamation, FaUser } from 'react-icons/fa6'
import type { Asset, FaceDto } from '@photox/shared-types'

export interface FacesSectionProps {
  asset: Asset
}

function FaceRow({ face, index }: { face: FaceDto; index: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(face.confidence * 100)))
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-6 h-6 rounded-md bg-amber-400/15 text-amber-300 font-bold text-xs flex items-center justify-center tabular-nums">
        {index + 1}
      </span>
      <FaUser className="text-amber-300 text-sm shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400">Confidence</span>
          <span className="tabular-nums text-slate-200">{pct}%</span>
        </div>
        <div className="h-1 bg-border-dark rounded-full overflow-hidden mt-1">
          <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </li>
  )
}

export function FacesSection({ asset }: FacesSectionProps) {
  const faces: FaceDto[] = asset.faces ?? []
  const status = asset.faceStatus

  if (status === 'pending') {
    return (
      <section>
        <div className="flex items-center gap-2 text-slate-400 mb-2">
          <FaUser className="text-[18px]" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Faces</h4>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <FaSpinner className="text-primary animate-spin text-xs" />
          <span>Detecting faces…</span>
        </div>
      </section>
    )
  }

  if (status === 'failed') {
    return (
      <section>
        <div className="flex items-center gap-2 text-slate-400 mb-2">
          <FaUser className="text-[18px]" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Faces</h4>
        </div>
        <p className="text-sm text-slate-500 inline-flex items-center gap-1.5">
          <FaTriangleExclamation className="text-amber-500 text-xs" />
          Face detection failed
        </p>
      </section>
    )
  }

  if (faces.length === 0) {
    return (
      <section>
        <div className="flex items-center gap-2 text-slate-400 mb-2">
          <FaUser className="text-[18px]" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Faces</h4>
        </div>
        <p className="text-sm text-slate-600 italic">No faces detected</p>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center gap-2 text-slate-400 mb-3">
        <FaUser className="text-[18px]" />
        <h4 className="text-xs font-bold uppercase tracking-wider">Faces</h4>
        <span className="ml-auto text-[10px] text-slate-500 tabular-nums">{faces.length}</span>
      </div>
      <ul className="space-y-2">
        {faces.map((face, i) => (
          <FaceRow key={face.id} face={face} index={i} />
        ))}
      </ul>
    </section>
  )
}
