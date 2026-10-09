import { useEffect, useMemo, useState } from 'react'
import { FaSpinner, FaTriangleExclamation, FaUser } from 'react-icons/fa6'
import type { Asset, FaceDto, PersonDto } from '@photox/shared-types'
import { listPersons } from '../../../api/persons'
import { assignFace } from '../../../api/faces'
import { FaceThumb } from '../../FaceThumb'

interface FacesSectionProps {
  asset: Asset
  onFaceHover?: (faceId: string | null) => void
}

function FaceRow({
  face,
  index,
  persons,
  personMap,
  onReassign,
  onFaceHover,
}: {
  face: FaceDto
  index: number
  persons: PersonDto[]
  personMap: Map<string, PersonDto>
  onReassign: (faceId: string, toPersonId: string | null) => void
  onFaceHover?: (faceId: string | null) => void
}) {
  const pct = Math.max(0, Math.min(100, Math.round(face.confidence * 100)))
  const person = face.personId ? personMap.get(face.personId) : undefined
  const personName = person?.name ?? null
  const coverFaceId = person?.coverFaceId ?? null

  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-6 h-6 rounded-md bg-amber-400/15 text-amber-300 font-bold text-xs flex items-center justify-center tabular-nums">
        {index + 1}
      </span>
      <span
        className="w-11 h-11 rounded-md overflow-hidden shrink-0 bg-slate-800 flex items-center justify-center"
        onMouseEnter={() => onFaceHover?.(face.id)}
        onMouseLeave={() => onFaceHover?.(null)}
      >
        {coverFaceId ? (
          <FaceThumb
            faceId={coverFaceId}
            alt={person?.name ?? person?.clusterLabel ?? 'Assigned'}
            className="w-full h-full object-cover"
          />
        ) : (
          <FaUser className="text-slate-500 text-xs" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400">Confidence</span>
          <span className="tabular-nums text-slate-200">{pct}%</span>
        </div>
        <div className="h-1 bg-border-dark rounded-full overflow-hidden mt-1">
          <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
        </div>
        {(personName ?? face.personId) && (
          <p className="text-[11px] text-slate-400 mt-1 truncate">{personName ?? 'Assigned'}</p>
        )}
        <div className="mt-1.5">
          <select
            value={face.personId ?? ''}
            onChange={(e) => onReassign(face.id, e.target.value || null)}
            className="w-full text-[11px] bg-slate-800 text-slate-300 border border-border-dark rounded px-1.5 py-0.5 focus:outline-none focus:border-primary"
          >
            <option value="">Unassigned</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.clusterLabel ?? 'Unknown'}
              </option>
            ))}
          </select>
        </div>
      </div>
    </li>
  )
}

export function FacesSection({ asset, onFaceHover }: FacesSectionProps) {
  const status = asset.faceStatus
  const [faces, setFaces] = useState<FaceDto[]>(asset.faces ?? [])
  const [persons, setPersons] = useState<PersonDto[]>([])
  const personMap = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons])

  useEffect(() => {
    setFaces(asset.faces ?? [])
  }, [asset])

  useEffect(() => {
    if (faces.length === 0) return
    listPersons({ limit: 200 })
      .then((res) => setPersons(res.items))
      .catch(() => {
        /* ponytail: silent fail */
      })
  }, [faces.length])

  const handleReassign = async (faceId: string, toPersonId: string | null) => {
    const face = faces.find((f) => f.id === faceId)
    if (!face) return

    try {
      await assignFace(faceId, toPersonId)
      setFaces((prev) => prev.map((f) => (f.id === faceId ? { ...f, personId: toPersonId } : f)))
    } catch {
      window.alert('Failed to reassign face. Please try again.')
    }
  }

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
          <FaceRow
            key={face.id}
            face={face}
            index={i}
            persons={persons}
            personMap={personMap}
            onFaceHover={onFaceHover}
            onReassign={(faceId, toPersonId) => {
              void handleReassign(faceId, toPersonId)
            }}
          />
        ))}
      </ul>
    </section>
  )
}
