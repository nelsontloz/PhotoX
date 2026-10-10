import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaFaceSmile } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { ErrorState, LoadingState } from '../../components/StateViews'
import { ViewerHost } from '../../components/ViewerHost'
import { TimelineAssets } from '../../components/Timeline/TimelineAssets'
import { renamePerson } from '../../api/persons'
import { usePersonDetail } from '../../hooks/usePersonDetail'
import { useInlineRename } from '../../hooks/useInlineRename'
import { useTimelineView } from '../../hooks/useTimelineView'
import type { Asset } from '@photox/shared-types'

function PersonDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const { person, setPerson, loading: personLoading } = usePersonDetail(id)
  // Same lazy pipeline as the home timeline, scoped to this person (layout + per-month fetches).
  const view = useTimelineView({ personId: id })
  const { timeline, loadedAssets } = view
  const { editing, nameValue, setNameValue, start, save } = useInlineRename(
    person?.name ?? '',
    async (name) => {
      const updated = await renamePerson(id, name || null)
      setPerson(updated)
    },
    { allowEmpty: true },
  )
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  if (personLoading || timeline.loading)
    return <LoadingState className="flex justify-center py-20" />
  if (timeline.error)
    return <ErrorState message={timeline.error} onRetry={() => window.location.reload()} />
  if (!person)
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <FaFaceSmile className="text-4xl text-slate-500 mb-4" />
        <p className="text-slate-400">Person not found</p>
      </div>
    )

  return (
    <>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => {
              void navigate('/people')
            }}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <FaArrowLeft className="text-xl" />
          </button>
          {editing ? (
            <input
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={() => {
                void save()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
              className="text-2xl font-bold text-white bg-transparent border-b border-primary outline-none"
            />
          ) : (
            <h1
              onClick={start}
              className="text-2xl font-bold text-white cursor-pointer hover:text-primary transition-colors"
              title="Click to rename"
            >
              {person.name ?? 'Unknown'}
            </h1>
          )}
          <span className="text-slate-400 text-sm">
            {person.faceCount} {person.faceCount === 1 ? 'face' : 'faces'}
          </span>
        </div>

        {timeline.layout.buckets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FaFaceSmile className="text-4xl text-slate-500 mb-4" />
            <p className="text-slate-400">No assets with this person</p>
          </div>
        ) : (
          <TimelineAssets view={view} onSelect={setSelectedAsset} />
        )}
      </div>

      <ViewerHost
        asset={selectedAsset}
        onClose={() => setSelectedAsset(null)}
        hasPrev={false}
        hasNext={false}
        onAddToAlbum={() => setPickerOpen(true)}
        siblingAssets={loadedAssets}
        onSelectSibling={setSelectedAsset}
        pickerOpen={pickerOpen}
        onPickerClose={() => setPickerOpen(false)}
      />
    </>
  )
}

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <RequireAuth>
      <AppShell>{id ? <PersonDetail key={id} id={id} /> : null}</AppShell>
    </RequireAuth>
  )
}
