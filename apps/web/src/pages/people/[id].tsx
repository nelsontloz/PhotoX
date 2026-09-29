import { Suspense, lazy, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaSpinner, FaFaceSmile } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { GalleryItem } from '../../components/GalleryItem'
import { FaceOverlay } from '../../components/AssetViewer/FaceOverlay'
import { AlbumPickerDialog } from '../../components/AlbumPickerDialog'
import { renamePerson } from '../../api/persons'
import { usePersonDetail } from '../../hooks/usePersonDetail'
import { useInlineRename } from '../../hooks/useInlineRename'
import type { Asset } from '@photox/shared-types'

const AssetViewer = lazy(() =>
  import('../../components/AssetViewer/AssetViewer').then((m) => ({ default: m.AssetViewer })),
)

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { person, setPerson, assets, faceMap, total, loading } = usePersonDetail(id)
  const { editing, nameValue, setNameValue, start, save } = useInlineRename(
    person?.name ?? '',
    async (name) => {
      if (!id) return
      const updated = await renamePerson(id, name || null)
      setPerson(updated)
    },
    { allowEmpty: true },
  )
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

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
          <>
            <Suspense fallback={null}>
              <AssetViewer
                asset={selectedAsset}
                onClose={() => setSelectedAsset(null)}
                hasPrev={false}
                hasNext={false}
                onAddToAlbum={() => setPickerOpen(true)}
                siblingAssets={assets}
                onSelectSibling={setSelectedAsset}
              />
            </Suspense>
            <AlbumPickerDialog
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              assetIds={[selectedAsset.id]}
            />
          </>
        )}
      </AppShell>
    </RequireAuth>
  )
}
