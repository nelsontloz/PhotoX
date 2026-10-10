import { useState } from 'react'
import { FaUsers, FaTrash, FaCopy, FaCheck, FaPhotoFilm, FaImage, FaVideo } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { useConfirm } from '../../components/ConfirmProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews'
import { listShares, revokeShare, getShareUrl } from '../../api/shares'
import { getVideoStreamUrl } from '../../api/assets'
import { useAsyncFetch } from '../../hooks/useAsyncFetch'
import type { ShareDto } from '@photox/shared-types'

function SharedContent() {
  const confirm = useConfirm()
  const { data, loading, error, refresh } = useAsyncFetch(() => listShares(), {
    errorMessage: 'Failed to load shares',
    loadingMode: 'always',
  })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // revoke is optimistic: hide the row immediately, the next fetch is the source of truth
  const [revokedIds, setRevokedIds] = useState<Set<string>>(new Set())
  const shares = (data?.items ?? []).filter((s) => !revokedIds.has(s.id))

  const handleCopy = async (share: ShareDto) => {
    const url = getShareUrl(share.token)
    await navigator.clipboard.writeText(url)
    setCopiedId(share.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleRevoke = async (share: ShareDto) => {
    if (
      !(await confirm({
        title: 'Revoke this share link?',
        body: 'Anyone with the link will no longer be able to view it.',
        confirmLabel: 'Revoke',
        destructive: true,
      }))
    )
      return
    try {
      await revokeShare(share.id)
      setRevokedIds((prev) => new Set(prev).add(share.id))
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return <LoadingState />
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void refresh()} />
  }

  if (shares.length === 0) {
    return (
      <EmptyState
        icon={<FaUsers className="text-4xl text-primary" />}
        circleClassName="bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/20"
        title="No shared links yet"
        body="Open a photo or an album and use Share to create a public link."
      />
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Shared</h1>
        <p className="text-sm text-slate-500 mt-1">
          {shares.length} active {shares.length === 1 ? 'link' : 'links'}
        </p>
      </header>

      <div className="space-y-3">
        {shares.map((share) => {
          const isAlbum = share.kind === 'album'
          const isVideo = share.kind === 'asset' && share.assetKind === 'video'
          const thumbFileId = isAlbum ? share.albumCoverThumbFileId : share.assetThumbFileId
          const sharedDate = new Date(share.createdAt).toLocaleDateString()
          const subtitle = isAlbum
            ? `${share.albumAssetCount} ${
                share.albumAssetCount === 1 ? 'item' : 'items'
              } · Shared ${sharedDate}`
            : `Shared ${sharedDate}`
          return (
            <div
              key={share.id}
              className="flex items-center gap-4 bg-card-dark border border-border-dark rounded-lg px-4 py-3"
            >
              {thumbFileId ? (
                <img
                  src={getVideoStreamUrl(thumbFileId)}
                  alt=""
                  className="w-12 h-12 rounded object-cover bg-slate-800 shrink-0"
                />
              ) : isAlbum ? (
                <div className="w-12 h-12 rounded bg-slate-800 shrink-0 flex items-center justify-center">
                  <FaPhotoFilm className="text-slate-600" />
                </div>
              ) : null}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  {isAlbum ? (
                    <>
                      <p className="text-sm text-slate-200 font-medium truncate">
                        {share.albumName}
                      </p>
                      <span className="shrink-0 inline-flex items-center text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
                        Album
                      </span>
                    </>
                  ) : (
                    <p className="inline-flex items-center gap-1.5 text-sm text-slate-200 font-medium">
                      {isVideo ? (
                        <FaVideo className="text-xs text-slate-500" />
                      ) : (
                        <FaImage className="text-xs text-slate-500" />
                      )}
                      {isVideo ? 'Video' : 'Photo'}
                    </p>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
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
          )
        })}
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
