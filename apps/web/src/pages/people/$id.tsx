import { Suspense, lazy, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaSpinner, FaFaceSmile } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { getPerson, getPersonAssets, renamePerson } from '../../api/persons'
import { getAsset } from '../../api/assets'
import type { PersonDto, PersonAssetItem, Asset } from '@photox/shared-types'

const AssetViewer = lazy(() =>
  import('../../components/AssetViewer/AssetViewer').then((m) => ({ default: m.AssetViewer })),
)

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [person, setPerson] = useState<PersonDto | null>(null)
  const [assets, setAssets] = useState<PersonAssetItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([getPerson(id), getPersonAssets(id, { limit: 100 })])
      .then(([p, a]) => {
        setPerson(p)
        setAssets(a.items)
        setTotal(a.total)
      })
      .catch(() => { /* ponytail: silent fail */ })
      .finally(() => setLoading(false))
  }, [id])

  const handleRename = async () => {
    if (!id) return
    try {
      const updated = await renamePerson(id, nameValue || null)
      setPerson(updated)
      setEditingName(false)
    } catch {
      setEditingName(false)
    }
  }

  const handleAssetClick = async (assetId: string) => {
    try {
      const asset = await getAsset(assetId)
      setSelectedAsset(asset)
    } catch {
      // ponytail: asset fetch fails silently
    }
  }

  if (loading) {
    return (
      <RequireAuth>
        <AppShell>
          <div className="flex justify-center py-20">
            <FaSpinner className="text-primary text-2xl animate-spin" />
          </div>
        </AppShell>
      </RequireAuth>
    )
  }

  if (!person) {
    return (
      <RequireAuth>
        <AppShell>
          <div className="flex flex-col items-center justify-center py-20">
            <FaFaceSmile className="text-4xl text-slate-500 mb-4" />
            <p className="text-slate-400">Person not found</p>
          </div>
        </AppShell>
      </RequireAuth>
    )
  }

  return (
    <RequireAuth>
      <AppShell>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => { void navigate('/people') }}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <FaArrowLeft className="text-xl" />
            </button>
            {editingName ? (
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={() => { void handleRename() }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRename()
                }}
                className="text-2xl font-bold text-white bg-transparent border-b border-primary outline-none"
              />
            ) : (
              <h1
                onClick={() => {
                  setEditingName(true)
                  setNameValue(person.name ?? '')
                }}
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

          {assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <FaFaceSmile className="text-4xl text-slate-500 mb-4" />
              <p className="text-slate-400">No assets with this person</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {assets.map((item) => (
                <button
                  key={item.faceId}
                  onClick={() => { void handleAssetClick(item.assetId) }}
                  className="aspect-square rounded-lg overflow-hidden bg-card-dark border border-border-dark hover:border-primary/50 transition-colors"
                >
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FaFaceSmile className="text-2xl text-slate-500" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {total > assets.length && (
            <div className="flex justify-center mt-6">
              <p className="text-sm text-slate-400">
                Showing {assets.length} of {total}
              </p>
            </div>
          )}
        </div>

        {selectedAsset && (
          <Suspense fallback={null}>
            <AssetViewer
              asset={selectedAsset}
              onClose={() => setSelectedAsset(null)}
              hasPrev={false}
              hasNext={false}
            />
          </Suspense>
        )}
      </AppShell>
    </RequireAuth>
  )
}
