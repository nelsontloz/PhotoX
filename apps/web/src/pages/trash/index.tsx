import { useState } from 'react'
import { FaSpinner, FaTrash, FaTrashCan } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { useConfirm } from '../../components/ConfirmProvider'
import { DayGroups } from '../../components/DayGroups'
import { ViewerHost } from '../../components/ViewerHost'
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
      <DayGroups groups={groups} onSelect={nav.open} dark />
      <ViewerHost
        asset={nav.selected}
        onClose={nav.close}
        onPrev={nav.goPrev}
        onNext={nav.goNext}
        hasPrev={nav.hasPrev}
        hasNext={nav.hasNext}
        onRestore={() => {
          void nav.restore()
        }}
        onDelete={() => {
          void nav.permanentlyDelete()
        }}
        siblingAssets={groups.flatMap((g) => g.items)}
        onSelectSibling={(asset) => nav.open(asset)}
        pickerOpen={pickerOpen}
        onPickerClose={() => setPickerOpen(false)}
      />
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
