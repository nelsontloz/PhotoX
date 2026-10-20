import { useState } from 'react'
import {
  FaArrowsRotate,
  FaCamera,
  FaFilm,
  FaSpinner,
  FaTriangleExclamation,
  FaTrashCan,
} from 'react-icons/fa6'
import { getAdminAssetCounts, reprocessThumbnails, getOrphanCounts } from '../../api/admin'
import { AdminSection, AdminToast, Button, CountTile, StatStrip, colsFor } from './ui'
import { ConfirmDialog, InlineError } from './shared'
import { useAsyncFetch } from '../../hooks/useAsyncFetch'

// --- small shared panels ----------------------------------------------------------------

interface MatrixPanelProps {
  title: string
  icon: typeof FaCamera
  tiles: { count: number; label: string }[]
}

function MatrixPanel({ title, icon: Icon, tiles }: MatrixPanelProps) {
  return (
    <div className="bg-surface-container rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="text-outline text-xs" />
        <span className="text-label-sm text-on-surface">{title}</span>
      </div>
      <div className={`grid ${colsFor(tiles.length)} gap-2`}>
        {tiles.map((t) => (
          <CountTile key={t.label} count={t.count} label={t.label} />
        ))}
      </div>
    </div>
  )
}

function SkeletonPanel({ tileCount = 4 }: { tileCount?: number }) {
  return (
    <div className="bg-surface-container rounded-lg p-4">
      <div className="h-3 w-32 rounded bg-surface-container-high animate-pulse mb-4" />
      <div className={`grid ${colsFor(tileCount)} gap-2`}>
        {Array.from({ length: tileCount }).map((_, i) => (
          <div key={i} className="text-center">
            <div className="h-8 w-10 mx-auto rounded bg-surface-container-high animate-pulse mb-2" />
            <div className="h-2.5 w-full rounded bg-surface-container-high animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

// --- asset health & queues (merges the counts matrix + thumbnail reprocess) -------------

export function AssetHealthSection() {
  const [version, setVersion] = useState(0)
  const { data, loading, error } = useAsyncFetch(() => getAdminAssetCounts(), {
    refreshKey: version,
    errorMessage: 'Failed to load asset counts',
    loadingMode: 'always',
  })

  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [reprocessError, setReprocessError] = useState<string | null>(null)

  const onConfirm = async () => {
    setConfirming(false)
    setInFlight(true)
    setReprocessError(null)
    setResult(null)
    try {
      const res = await reprocessThumbnails('photo')
      setResult(
        `Enqueued ${res.enqueued.toLocaleString()} jobs for ${res.totalAssets.toLocaleString()} pictures.`,
      )
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : 'Reprocess failed')
    } finally {
      setInFlight(false)
    }
  }

  return (
    <AdminSection
      headingTag="h3"
      title="Asset Health & Pipeline Queues"
      icon={<FaTriangleExclamation />}
      actions={
        <Button
          variant="icon"
          onClick={() => setVersion((v) => v + 1)}
          ariaLabel="Refresh asset health"
          icon={<FaArrowsRotate />}
        />
      }
    >
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SkeletonPanel tileCount={3} />
          <SkeletonPanel tileCount={4} />
        </div>
      ) : error ? (
        <InlineError message={error} onRetry={() => setVersion((v) => v + 1)} />
      ) : data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MatrixPanel
            title="Photo Processing Matrix"
            icon={FaCamera}
            tiles={[
              { count: data.photos.processing, label: 'Processing' },
              { count: data.photos.metadata, label: 'Metadata' },
              { count: data.photos.thumbnails, label: 'Thumbnails' },
            ]}
          />
          <MatrixPanel
            title="Video Transcoding Matrix"
            icon={FaFilm}
            tiles={[
              { count: data.videos.processing, label: 'Processing' },
              { count: data.videos.metadata, label: 'Metadata' },
              { count: data.videos.thumbnails, label: 'Thumbnails' },
              { count: data.videos.encoding, label: 'Encoding' },
            ]}
          />
        </div>
      ) : null}

      <div className="border-t border-border-dark/40 pt-4 mt-4 flex items-start justify-between gap-4 flex-wrap">
        <p className="text-body-sm text-on-surface-variant max-w-lg">
          Regenerate thumbnails for all pictures. Existing thumbs are replaced.
        </p>
        <Button
          onClick={() => setConfirming(true)}
          disabled={inFlight}
          icon={inFlight ? <FaSpinner className="animate-spin" /> : undefined}
        >
          {inFlight ? 'Enqueuing…' : 'Reprocess pictures'}
        </Button>
      </div>

      {result && <AdminToast message={result} />}
      {reprocessError && <AdminToast message={reprocessError} tone="error" />}

      {confirming && (
        <ConfirmDialog
          title="Reprocess all pictures?"
          onClose={() => setConfirming(false)}
          onConfirm={() => void onConfirm()}
        >
          <p className="text-sm text-slate-400 mt-2">
            This regenerates thumbnails for every non-trashed picture and replaces the existing
            ones. The worker processes one job at a time, so this can take a while on large
            libraries.
          </p>
        </ConfirmDialog>
      )}
    </AdminSection>
  )
}

// --- orphan cleanup ---------------------------------------------------------------------

export function OrphanCleanupSection() {
  const [version, setVersion] = useState(0)
  const { data, loading, error } = useAsyncFetch(() => getOrphanCounts(), {
    refreshKey: version,
    errorMessage: 'Failed to load orphan counts',
    loadingMode: 'always',
  })

  return (
    <AdminSection
      headingTag="h3"
      title="Orphan Cleanup"
      subtitle="Files and thumbnails in storage that no asset references."
      icon={<FaTrashCan />}
      actions={
        <Button
          variant="icon"
          onClick={() => setVersion((v) => v + 1)}
          ariaLabel="Refresh orphan counts"
          icon={<FaArrowsRotate />}
        />
      }
    >
      {loading ? (
        <SkeletonPanel tileCount={2} />
      ) : error ? (
        <InlineError message={error} onRetry={() => setVersion((v) => v + 1)} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <CountTile boxed count={data.orphanFiles} label="Orphan files" />
            <CountTile boxed count={data.orphanThumbnails} label="Orphan thumbnails" />
          </div>
          <div className="mt-4">
            <StatStrip
              rows={[
                { label: 'Scope', value: 'Storage files + thumbnails' },
                { label: 'Trigger', value: 'On demand' },
              ]}
            />
          </div>
        </>
      ) : null}
    </AdminSection>
  )
}
