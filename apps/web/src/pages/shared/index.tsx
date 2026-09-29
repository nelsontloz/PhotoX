import { useEffect, useState } from 'react'
import { FaUsers, FaTrash, FaCopy, FaCheck } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { listShares, revokeShare, getShareUrl } from '../../api/shares'
import { getVideoStreamUrl } from '../../api/assets'
import type { AssetShareDto } from '@photox/shared-types'

function SharedContent() {
  const [shares, setShares] = useState<AssetShareDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchShares = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await listShares()
      setShares(res.items)
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load shares')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchShares()
  }, [])

  const handleCopy = async (share: AssetShareDto) => {
    const url = getShareUrl(share.token)
    await navigator.clipboard.writeText(url)
    setCopiedId(share.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleRevoke = async (share: AssetShareDto) => {
    if (
      !window.confirm(
        'Revoke this share link? Anyone with the link will no longer be able to view it.',
      )
    )
      return
    try {
      await revokeShare(share.id)
      setShares((prev) => prev.filter((s) => s.id !== share.id))
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return <LoadingState />
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void fetchShares()} />
  }

  if (shares.length === 0) {
    return (
      <EmptyState
        icon={<FaUsers className="text-4xl text-primary" />}
        circleClassName="bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/20"
        title="No shared photos yet"
        body="Open a photo and tap the share icon to create a public link."
      />
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Shared</h1>
        <p className="text-sm text-slate-500 mt-1">
          {shares.length} {shares.length === 1 ? 'link' : 'links'} active
        </p>
      </header>

      <div className="space-y-3">
        {shares.map((share) => (
          <div
            key={share.id}
            className="flex items-center gap-4 bg-card-dark border border-border-dark rounded-lg px-4 py-3"
          >
            {share.assetThumbFileId && (
              <img
                src={getVideoStreamUrl(share.assetThumbFileId, share.userId)}
                alt=""
                className="w-12 h-12 rounded object-cover bg-slate-800 shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-200 font-medium truncate">
                {share.assetId.slice(0, 8)}…
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Shared {new Date(share.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => void handleCopy(share)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-md transition-colors"
                title="Copy share link"
              >
                {copiedId === share.id ? <FaCheck className="text-green-400" /> : <FaCopy />}
                {copiedId === share.id ? 'Copied' : 'Copy link'}
              </button>
              <button
                onClick={() => void handleRevoke(share)}
                className="p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded-md hover:bg-red-500/10"
                title="Revoke share"
              >
                <FaTrash className="text-sm" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SharedPage() {
  return (
    <RequireAuth>
      <AppShell>
        <SharedContent />
      </AppShell>
    </RequireAuth>
  )
}
