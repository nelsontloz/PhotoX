import { useState } from 'react'
import { FaSpinner, FaTrash, FaTrashCan } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { useConfirm } from '../../components/ConfirmProvider'
import { GalleryItem } from '../../components/GalleryItem'
import { AssetViewer } from '../../components/AssetViewer/AssetViewer'
import { AlbumPickerDialog } from '../../components/AlbumPickerDialog'
import { useAssetGroups } from '../../hooks/useAssetGroups'
import { useAssetNavigation } from '../../hooks/useAssetNavigation'
import { emptyTrash } from '../../api/assets'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'

function TrashContent() {
  const confirm = useConfirm()
  const { groups, loading, error, refresh } = useAssetGroups({
    isTrashed: true,
    dateField: 'trashedAt',
  })
  const nav = useAssetNavigation({
    assets: groups.flatMap((g) => g.items),
    onAfterAction: refresh,
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [emptying, setEmptying] = useState(false)

  const handleEmptyTrash = async () => {
    if (
      !(await confirm({
        title: 'Empty trash?',
        body: 'All items in trash will be permanently deleted. This cannot be undone.',
        confirmLabel: 'Empty trash',
        destructive: true,
      }))
    )
      return
    setEmptying(true)
    try {
      await emptyTrash()
      await refresh()
    } catch {
      window.alert('Failed to empty trash. Please try again.')
    } finally {
      setEmptying(false)
    }
  }

  if (loading) {
    return <LoadingState />
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<FaTrash className="text-4xl text-red-500 dark:text-red-400" />}
        circleClassName="bg-red-500/10 dark:bg-red-500/15 ring-1 ring-red-500/25"
        title="Trash is empty"
        body="Photos you delete from your timeline will appear here."
      />
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div />
        <button
          onClick={() => void handleEmptyTrash()}
          disabled={emptying}
          className="text-sm font-semibold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-md px-3 py-1.5 inline-flex items-center gap-2"
        >
          {emptying ? <FaSpinner className="animate-spin" /> : <FaTrashCan />}
          Empty trash
        </button>
      </div>
      {groups.map((group) => (
        <section key={group.sortKey} className="mb-10">
          <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-transparent dark:border-transparent transition-all">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {group.label}
            </h2>
          </div>
          <div className="justified-grid-gallery">
            {group.items.map((asset) => {
              return <GalleryItem key={asset.id} asset={asset} onSelect={nav.open} dark />
            })}
          </div>
        </section>
      ))}
      {nav.selected && (
        <>
          <AssetViewer
            asset={nav.selected}
            onClose={nav.close}
            onPrev={nav.goPrev}
            onNext={nav.goNext}
            hasPrev={nav.hasPrev}
            hasNext={nav.hasNext}
            onAddToAlbum={!nav.selected.isTrashed ? () => setPickerOpen(true) : undefined}
            onRestore={() => {
              void nav.restore()
            }}
            onDelete={() => {
              void nav.permanentlyDelete()
            }}
            siblingAssets={groups.flatMap((g) => g.items)}
            onSelectSibling={(asset) => nav.open(asset)}
          />
          <AlbumPickerDialog
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            assetIds={[nav.selected.id]}
          />
        </>
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
