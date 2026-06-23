import { useEffect, useState, useCallback } from 'react'
import type { Asset } from '@photox/shared-types'
import { downloadFile } from '../../api/assets'
import { useThumbStore } from '../../store/thumb-store'
import { useViewerAsset } from './useViewerAsset'
import { ViewerTopBar } from './ViewerTopBar'
import { ViewerImageStage } from './ViewerImageStage'
import { ViewerThumbStrip } from './ViewerThumbStrip'
import { ViewerInfoPanel } from './ViewerInfoPanel'

interface AssetViewerProps {
  assetId: string
  contextAssets: Asset[]
  onClose: () => void
}

export function AssetViewer({ assetId, contextAssets, onClose }: AssetViewerProps) {
  const { asset, prev, next, hasContext } = useViewerAsset(assetId, contextAssets)
  const [currentId, setCurrentId] = useState(assetId)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(() => window.innerWidth >= 768)
  const localThumb = useThumbStore((s) => asset && s.urls[asset.fileId])

  useEffect(() => {
    setCurrentId(assetId)
  }, [assetId])

  useEffect(() => {
    if (asset?.kind !== 'photo' || localThumb) return
    let cancelled = false
    downloadFile(asset.fileId)
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch(() => {
        /* ignored */
      })

    return () => {
      cancelled = true
    }
  }, [asset, localThumb])

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  const goToPrev = useCallback(() => {
    if (prev) {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setObjectUrl(null)
      setCurrentId(prev.id)
    }
  }, [prev, objectUrl])

  const goToNext = useCallback(() => {
    if (next) {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setObjectUrl(null)
      setCurrentId(next.id)
    }
  }, [next, objectUrl])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') goToPrev()
      if (e.key === 'ArrowRight') goToNext()
      if (e.key === 'i') setInfoOpen((o) => !o)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, goToPrev, goToNext])

  const contextForStrip = hasContext ? contextAssets : asset ? [asset] : []
  const displayUrl = localThumb ?? objectUrl

  return (
    <div className="fixed inset-0 bg-modal-overlay flex overflow-hidden z-50">
      <div className="relative flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {asset && (
          <>
            <ViewerTopBar
              asset={asset}
              infoOpen={infoOpen}
              onToggleInfo={() => setInfoOpen((o) => !o)}
            />
            <ViewerImageStage
              asset={asset}
              objectUrl={displayUrl}
              onPrev={goToPrev}
              onNext={goToNext}
              hasPrev={!!prev}
              hasNext={!!next}
            />
            <ViewerThumbStrip
              assets={contextForStrip}
              currentId={currentId}
              onSelect={(a) => {
                if (objectUrl) URL.revokeObjectURL(objectUrl)
                setObjectUrl(null)
                setCurrentId(a.id)
              }}
            />
          </>
        )}
      </div>
      <ViewerInfoPanel asset={asset!} open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  )
}
