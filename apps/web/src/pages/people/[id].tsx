import { Suspense, lazy, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaSpinner, FaFaceSmile } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { GalleryItem } from '../../components/GalleryItem'
import { FaceOverlay } from '../../components/AssetViewer/FaceOverlay'
import { getPerson, getPersonAssets, renamePerson } from '../../api/persons'
import { getAsset } from '../../api/assets'
import type { Asset, FaceDto, PersonDto } from '@photox/shared-types'

const AssetViewer = lazy(() =>
  import('../../components/AssetViewer/AssetViewer').then((m) => ({ default: m.AssetViewer })),
)

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [person, setPerson] = useState<PersonDto | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [faceMap, setFaceMap] = useState<Map<string, FaceDto>>(new Map())
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)

  useEffect(() => {
    if (!id) return
    void (async () => {
      try {
        const [p, personAssets] = await Promise.all([
          getPerson(id),
          getPersonAssets(id, { limit: 100 }),
        ])
        setPerson(p)
        setTotal(personAssets.total)
        // ponytail: fetch full assets in parallel to get faces (for box overlay) + original dims
        const fetched = await Promise.all(
          personAssets.items.map((item) => getAsset(item.assetId).catch(() => null)),
        )
        const valid = fetched.filter((a): a is Asset => a !== null)
        const fm = new Map<string, FaceDto>()
        personAssets.items.forEach((item, i) => {
          const a = fetched[i]
          if (!a?.faces) return
          const face = a.faces.find((f) => f.id === item.faceId)
          if (face) fm.set(item.assetId, face)
        })
        setAssets(valid)
        setFaceMap(fm)
      } catch {
        /* ponytail: silent fail */
      } finally {
        setLoading(false)
      }
    })()
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
              onClick={() => {
                void navigate('/people')
              }}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <FaArrowLeft className="text-xl" />
            </button>
            {editingName ? (
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={() => {
                  void handleRename()
                }}
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
            <div className="justified-grid-gallery">
              {assets.map((asset) => {
                const face = faceMap.get(asset.id)
                const faceOverlay =
                  face && asset.width && asset.height ? (
                    <FaceOverlay
                      faces={[face]}
                      imageWidth={asset.width}
                      imageHeight={asset.height}
                    />
                  ) : undefined
                return (
                  <GalleryItem
                    key={asset.id}
                    asset={asset}
                    onSelect={setSelectedAsset}
                    overlay={faceOverlay}
                  />
                )
              })}
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
