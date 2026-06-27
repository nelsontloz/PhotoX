import { useState } from 'react'
import { FaSpinner, FaTrash } from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { GalleryItem } from '../../components/GalleryItem'
import { AssetViewer } from '../../components/AssetViewer/AssetViewer'
import { restoreAsset } from '../../api/assets'
import { useAssetGroups } from '../../hooks/useAssetGroups'

function TrashContent() {
  const { groups, loading, error, refresh } = useAssetGroups({
    isTrashed: true,
    dateField: 'trashedAt',
  })
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)

  const allAssets = groups.flatMap((g) => g.items)
  const currentIndex = selectedAsset ? allAssets.findIndex((a) => a.id === selectedAsset.id) : -1
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < allAssets.length - 1

  const goPrev = () => {
    if (hasPrev) setSelectedAsset(allAssets[currentIndex - 1] ?? null)
  }
  const goNext = () => {
    if (hasNext) setSelectedAsset(allAssets[currentIndex + 1] ?? null)
  }
  const closeViewer = () => {
    setSelectedAsset(null)
  }

  const handleRestore = async () => {
    if (!selectedAsset) return
    try {
      await restoreAsset(selectedAsset.id)
      closeViewer()
      await refresh()
    } catch {
      window.alert('Failed to restore. Please try again.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <FaSpinner className="text-2xl text-primary animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <p className="text-red-500 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-primary text-sm font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center max-w-lg mx-auto">
        <div className="mb-8 w-20 h-20 rounded-full bg-red-500/10 dark:bg-red-500/15 ring-1 ring-red-500/25 flex items-center justify-center">
          <FaTrash className="text-4xl text-red-500 dark:text-red-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          Trash is empty
        </h1>
        <p className="mt-4 text-slate-500 dark:text-slate-400 text-base sm:text-lg leading-relaxed max-w-md">
          Photos you delete from your timeline will appear here.
        </p>
      </div>
    )
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.sortKey} className="mb-10">
          <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-transparent dark:border-transparent transition-all">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {group.label}
            </h2>
          </div>
          <div className="justified-grid-gallery">
            {group.items.map((asset) => {
              return <GalleryItem key={asset.id} asset={asset} onSelect={setSelectedAsset} dark />
            })}
          </div>
        </section>
      ))}
      {selectedAsset && (
        <AssetViewer
          asset={selectedAsset}
          onClose={closeViewer}
          onPrev={goPrev}
          onNext={goNext}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onRestore={() => {
            void handleRestore()
          }}
        />
      )}
    </div>
  )
}

export default function TrashPage() {
  return (
    <RequireAuth>
      <AppShell>
        <TrashContent />
      </AppShell>
    </RequireAuth>
  )
}
