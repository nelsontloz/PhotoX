import { useState, type CSSProperties } from 'react'
import { FaHeart, FaPlay, FaSpinner, FaTriangleExclamation } from 'react-icons/fa6'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { AssetThumb } from './AssetThumb'
import { formatDuration } from '../lib/format'

interface GalleryItemProps {
  asset: Asset
  onSelect?: (asset: Asset) => void
  dark?: boolean
}

export function GalleryItem({ asset, onSelect, dark = false }: GalleryItemProps) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)

  const w = dims?.width ?? asset.width ?? 1
  const h = dims?.height ?? asset.height ?? 1
  const figureStyle = {
    '--width': w,
    '--height': h,
  } as CSSProperties

  const isVideo = asset.kind === 'video'
  const transcodeStatus = isVideo ? asset.transcodeStatus : null
  const duration = isVideo ? formatDuration(asset.durationSeconds) : null

  return (
    <figure
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(asset)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.(asset)
        }
      }}
      style={figureStyle}
      className="group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <AssetThumb
        asset={asset}
        onThumbPicked={(t: AssetThumbnail) => setDims({ width: t.width, height: t.height })}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
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
      {dark && <div className="absolute inset-0 bg-black/40" aria-hidden="true" />}
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
}
