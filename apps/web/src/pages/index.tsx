import { FaHeart, FaImage, FaMountain, FaSpinner, FaWandMagicSparkles } from 'react-icons/fa6'
import { useNavigate } from 'react-router-dom'
import { RequireAuth } from '../components/RequireAuth'
import { AppShell } from '../components/AppShell'
import { AssetThumb } from '../components/AssetThumb'
import { UploadButton } from '../components/UploadButton'
import { useAssetGroups } from '../hooks/useAssetGroups'

function TimelineContent() {
  const { groups, loading, error, refresh } = useAssetGroups()
  const navigate = useNavigate()
  const flatAssets = groups.flatMap((g) => g.items)

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
        <div className="mb-12 relative w-64 h-64 flex items-center justify-center">
          <div className="absolute inset-0 bg-primary/5 blur-[100px] rounded-full animate-pulse" />
          <div className="relative w-32 h-32">
            <div className="absolute inset-0 rounded-[32px] bg-[#272a32] border border-[#424754]/20 rotate-12 shadow-2xl flex items-center justify-center">
              <FaImage className="text-6xl text-primary opacity-20" />
            </div>
            <div className="absolute -top-4 -left-4 w-32 h-32 rounded-[32px] bg-[#1d1f27] border border-[#424754]/20 -rotate-6 shadow-2xl flex items-center justify-center">
              <FaMountain className="text-6xl text-primary opacity-40" />
            </div>
            <div className="absolute -top-8 left-2 w-32 h-32 rounded-[32px] bg-[#32353d] border border-primary/30 shadow-2xl flex items-center justify-center">
              <FaWandMagicSparkles className="text-6xl text-primary" />
            </div>
          </div>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-100 mb-6">
          No memories yet
        </h1>
        <p className="text-slate-400 text-lg leading-relaxed max-w-sm mx-auto mb-10">
          Your timeline is currently empty. Start preserving your life's moments by uploading your
          first batch of photos.
        </p>
        <UploadButton
          onComplete={() => {
            void refresh()
          }}
        />
      </div>
    )
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.sortKey} className="mb-10">
          <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-transparent dark:border-transparent transition-all">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {group.label}
            </h2>
            <div className="ml-auto flex items-center">
              <button className="text-xs font-semibold text-primary hover:text-primary/80">
                Select all
              </button>
            </div>
          </div>
          <div className="asset-grid">
            {group.items.map((asset) => (
              <div
                key={asset.id}
                onClick={() => {
                  void navigate(`/assets/${asset.id}`, {
                    state: { context: flatAssets },
                  })
                }}
                className="relative group rounded overflow-hidden cursor-pointer aspect-square"
              >
                <AssetThumb asset={asset} aspect="square" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="w-6 h-6 rounded-full border-2 border-white/80 hover:bg-primary hover:border-primary flex items-center justify-center transition-colors"></div>
                </div>
                {asset.favorite && (
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="bg-black/50 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-bold text-white flex items-center gap-1">
                      <FaHeart className="text-[10px]" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

export default function TimelineRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <TimelineContent />
      </AppShell>
    </RequireAuth>
  )
}
