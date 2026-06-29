import { useState, type CSSProperties, type ReactNode } from 'react'
import { FaCheck, FaPlay, FaSpinner, FaTriangleExclamation, FaUser } from 'react-icons/fa6'
import type { Asset, AssetThumbnail } from '@photox/shared-types'
import { AssetThumb } from './AssetThumb'
import { formatDuration } from '../lib/format'
import { useLongPress } from '../hooks/useLongPress'

interface GalleryItemProps {
  asset: Asset
  onSelect?: (asset: Asset) => void
  dark?: boolean
  // ponytail: extra absolute-positioned content rendered inside the figure (e.g. face box overlay) — keeps the figure as the positioning context
  overlay?: ReactNode
  onLongPress?: (asset: Asset) => void
  showCheckbox?: boolean
  onToggleSelect?: (id: string) => void
  selected?: boolean
}

export function GalleryItem({
  asset,
  onSelect,
  dark = false,
  overlay,
  onLongPress,
  showCheckbox = true,
  onToggleSelect,
  selected = false,
}: GalleryItemProps) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const lp = useLongPress(() => onLongPress?.(asset))
  const longPressHandlers = onLongPress
    ? {
        onPointerDown: lp.onPointerDown,
        onPointerUp: lp.onPointerUp,
        onPointerLeave: lp.onPointerLeave,
        onPointerCancel: lp.onPointerCancel,
        onContextMenu: lp.onContextMenu,
      }
    : {}

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
      onClick={() => {
        if (lp.justLongPressedRef.current) return
        onSelect?.(asset)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.(asset)
        }
      }}
      style={figureStyle}
      className={`group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.98] transition-transform duration-150 ${
        selected ? 'shadow-[inset_0_0_0_2px_#136dec]' : ''
      }`}
      {...longPressHandlers}
    >
      <AssetThumb
        asset={asset}
        onThumbPicked={(t: AssetThumbnail) => setDims({ width: t.width, height: t.height })}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      {isVideo && transcodeStatus === 'ready' && (
        <div
          className={`absolute top-3 left-3 transition-opacity duration-200 pointer-events-none ${
            selected ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
          }`}
        >
          <div className="bg-black/60 backdrop-blur-sm rounded-full w-7 h-7 flex items-center justify-center">
            <FaPlay className="text-white text-[10px] ml-0.5" />
          </div>
        </div>
      )}
      {isVideo && transcodeStatus === 'pending' && (
        <div
          className={`absolute top-3 left-3 pointer-events-none transition-opacity duration-200 ${
            selected ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="bg-black/60 backdrop-blur-sm rounded-full w-7 h-7 flex items-center justify-center">
            <FaSpinner className="text-white text-[12px] animate-spin" />
          </div>
        </div>
      )}
      {isVideo && transcodeStatus === 'failed' && (
        <div
          className={`absolute top-3 left-3 pointer-events-none transition-opacity duration-200 ${
            selected ? 'opacity-0' : 'opacity-100'
          }`}
        >
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
      {asset.faceCount !== null && asset.faceCount !== undefined && asset.faceCount >= 1 && (
        <div className="absolute bottom-2 left-2 pointer-events-none">
          <div className="bg-black/65 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-semibold text-white inline-flex items-center gap-1 tabular-nums">
            <FaUser className="text-[10px]" />
            <span>{asset.faceCount >= 10 ? '10+' : asset.faceCount}</span>
          </div>
        </div>
      )}
      {onToggleSelect && showCheckbox && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? 'Deselect photo' : 'Select photo'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(asset.id)
          }}
          className={`absolute top-2 left-2 size-6 rounded-md z-10 flex items-center justify-center transition-colors ${
            selected
              ? 'bg-primary ring-2 ring-primary text-white'
              : 'bg-black/60 backdrop-blur-sm ring-1 ring-border-dark hover:bg-black/75'
          }`}
        >
          {selected && <FaCheck className="text-xs" />}
        </button>
      )}
      {overlay}
    </figure>
  )
}
