import { useState, type CSSProperties } from 'react'
import {
  FaHeart,
  FaImage,
  FaMountain,
  FaPlay,
  FaSpinner,
  FaTriangleExclamation,
  FaWandMagicSparkles,
} from 'react-icons/fa6'
import type { Asset } from '@photox/shared-types'
import { RequireAuth } from '../components/RequireAuth'
import { AppShell } from '../components/AppShell'
import { AssetThumb } from '../components/AssetThumb'
import { AssetViewer } from '../components/AssetViewer/AssetViewer'
import { UploadButton } from '../components/UploadButton'
import { DropZone } from '../components/DropZone'
import { useAssetGroups } from '../hooks/useAssetGroups'
import { trashAsset } from '../api/assets'
import { formatDuration } from '../lib/format'

function TimelineContent() {
  const { groups, loading, error, refresh } = useAssetGroups()
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

  const handleTrash = async () => {
    if (!selectedAsset) return
    const kindLabel = selectedAsset.kind === 'video' ? 'video' : 'photo'
    if (
      !window.confirm(
        `Move "${selectedAsset.originalName ?? selectedAsset.title ?? `this ${kindLabel}`}" to trash?`,
      )
    )
      return
    try {
      await trashAsset(selectedAsset.id)
      closeViewer()
      await refresh()
    } catch {
      window.alert('Failed to move to trash. Please try again.')
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
    <DropZone className="h-full">
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
          <div className="justified-grid-gallery">
            {group.items.map((asset) => {
              const isVideo = asset.kind === 'video'
              const transcodeStatus = isVideo ? asset.transcodeStatus : null
              const duration = isVideo ? formatDuration(asset.durationSeconds) : null
              const figureStyle = {
                '--width': asset.width ?? 1,
                '--height': asset.height ?? 1,
              } as CSSProperties
              return (
                <figure
                  key={asset.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedAsset(asset)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedAsset(asset)
                    }
                  }}
                  className="group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  style={figureStyle}
                >
                  <AssetThumb asset={asset} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                    <div className="w-6 h-6 rounded-full border-2 border-white/80 hover:bg-primary hover:border-primary flex items-center justify-center transition-colors"></div>
                  </div>
                  {isVideo && transcodeStatus === 'ready' && (
                    <div className="absolute top-3 left-3 group-hover:opacity-0 transition-opacity duration-200 pointer-events-none">
                      <div className="bg-black/60 backdrop-blur-sm rounded-full w-7 h-7 flex items-center justify-center">
                        <FaPlay className="text-white text-[10px] ml-0.5" />
                      </div>
                    </div>
                  )}
                  {isVideo && transcodeStatus === 'pending' && (
                    <div className="absolute top-3 left-3 pointer-events-none">
                      <div className="bg-black/60 backdrop-blur-sm rounded-full w-7 h-7 flex items-center justify-center">
                        <FaSpinner className="text-white text-[12px] animate-spin" />
                      </div>
                    </div>
                  )}
                  {isVideo && transcodeStatus === 'failed' && (
                    <div className="absolute top-3 left-3 pointer-events-none">
                      <div className="bg-amber-500/90 backdrop-blur-sm rounded-full w-7 h-7 flex items-center justify-center">
                        <FaTriangleExclamation className="text-white text-[12px]" />
                      </div>
                    </div>
                  )}
                  {isVideo && duration && (
                    <div className="absolute bottom-2 right-2 pointer-events-none">
                      <div className="bg-black/65 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                        {duration}
                      </div>
                    </div>
                  )}
                  {asset.favorite && (
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                      <div className="bg-black/50 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-bold text-white flex items-center gap-1">
                        <FaHeart className="text-[10px]" />
                      </div>
                    </div>
                  )}
                </figure>
              )
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
          onTrash={() => {
            void handleTrash()
          }}
        />
      )}
    </DropZone>
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
