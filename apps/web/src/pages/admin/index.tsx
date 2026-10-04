import { useEffect, useState } from 'react'
import {
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpDown,
  FaArrowsRotate,
  FaCamera,
  FaFaceSmile,
  FaFilm,
  FaMagnifyingGlass,
  FaSpinner,
  FaTrashCan,
  FaTriangleExclamation,
  FaUserShield,
} from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { RequireAdmin } from '../../components/RequireAdmin'
import { AppShell } from '../../components/AppShell'
import { Dialog } from '../../components/Dialog'
import { LoadingState } from '../../components/StateViews'
import { LibraryStatsSection } from './library-stats'
import {
  listAdminUsers,
  getAdminAssetCounts,
  reprocessThumbnails,
  cleanupOrphans,
  getOrphanCounts,
  getFaceDetection,
  setFaceDetector,
  reprocessFaces,
  getFaceReprocessStatus,
  reclusterFaces,
  reprocessEmbeddings,
  getEmbeddingReprocessStatus,
  reprocessDetections,
  getDetectionReprocessStatus,
  reprocessOcr,
  getOcrReprocessStatus,
  type ListAdminUsersParams,
  type FaceReprocessStatus,
  type EmbeddingReprocessStatus,
  type DetectionReprocessStatus,
  type OcrReprocessStatus,
} from '../../api/admin'
import type {
  AdminUserListResponse,
  AdminUserSortField,
  AdminAssetCountsResponse,
  FaceDetectionSettings,
  FaceDetectorKind,
} from '@photox/shared-types'

type SortDir = 'asc' | 'desc'

interface SortState {
  field: AdminUserSortField
  dir: SortDir
}

const DEFAULT_SORT: SortState = { field: 'createdAt', dir: 'desc' }
const DEFAULT_LIMIT = 20

function FailureTile({ count, label }: { count: number; label: string }) {
  return (
    <div className="text-center">
      <span
        className={`text-2xl font-bold tabular-nums ${count > 0 ? 'text-red-400' : 'text-slate-500'}`}
      >
        {count.toLocaleString()}
      </span>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">{label}</p>
    </div>
  )
}

interface FailureCardProps {
  kind: string
  icon: typeof FaCamera
  tiles: { count: number; label: string }[]
}

function FailureCard({ kind, icon: Icon, tiles }: FailureCardProps) {
  const colClass = tiles.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
  return (
    <div className="bg-card-dark border border-border-dark rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-200">{kind}</span>
      </div>
      <div className={`grid ${colClass} gap-3`}>
        {tiles.map((t) => (
          <FailureTile key={t.label} count={t.count} label={t.label} />
        ))}
      </div>
    </div>
  )
}

function SkeletonCard({ tileCount = 4 }: { tileCount?: number }) {
  const colClass = tileCount === 4 ? 'grid-cols-4' : 'grid-cols-3'
  return (
    <div className="bg-card-dark border border-border-dark rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-4 w-4 rounded bg-slate-700 animate-pulse" />
        <div className="h-4 w-16 rounded bg-slate-700 animate-pulse" />
      </div>
      <div className={`grid ${colClass} gap-3`}>
        {Array.from({ length: tileCount }).map((_, i) => (
          <div key={i} className="text-center">
            <div className="h-8 w-10 mx-auto rounded bg-slate-700 animate-pulse mb-2" />
            <div className="h-3 w-full rounded bg-slate-700 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

function AssetHealthSection() {
  const [data, setData] = useState<AdminAssetCountsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getAdminAssetCounts()
      .then((res) => {
        if (cancelled) return
        setData(res)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load asset counts')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [version])

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FaTriangleExclamation className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Asset health</h2>
        </div>
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          className="text-slate-400 hover:text-slate-200 transition-colors"
        >
          <FaArrowsRotate />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonCard tileCount={3} />
          <SkeletonCard tileCount={4} />
        </div>
      ) : error ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-4 text-center">
          <p className="text-xs text-red-400 mb-2">{error}</p>
          <button
            type="button"
            onClick={() => setVersion((v) => v + 1)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FailureCard
            kind="Pictures"
            icon={FaCamera}
            tiles={[
              { count: data.photos.processing, label: 'Processing' },
              { count: data.photos.metadata, label: 'Metadata' },
              { count: data.photos.thumbnails, label: 'Thumbnails' },
            ]}
          />
          <FailureCard
            kind="Videos"
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
    </section>
  )
}

function ThumbnailReprocessSection() {
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onConfirm = async () => {
    setConfirming(false)
    setInFlight(true)
    setError(null)
    setResult(null)
    try {
      const res = await reprocessThumbnails('photo')
      setResult(
        `Enqueued ${res.enqueued.toLocaleString()} jobs for ${res.totalAssets.toLocaleString()} pictures.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reprocess failed')
    } finally {
      setInFlight(false)
    }
  }

  return (
    <section>
      <div className="bg-card-dark border border-border-dark rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Maintenance</h2>
            <p className="text-xs text-slate-400 mt-1">
              Regenerate thumbnails for all pictures. Existing thumbs are replaced.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={inFlight}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {inFlight ? (
              <>
                <FaSpinner className="animate-spin" />
                Enqueuing…
              </>
            ) : (
              'Reprocess pictures'
            )}
          </button>
        </div>
        {result && <p className="text-xs text-emerald-400 mt-3">{result}</p>}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </div>

      {confirming && (
        <Dialog
          title="Reprocess all pictures?"
          onClose={() => setConfirming(false)}
          panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
          titleTag="h3"
          titleClassName="text-base font-semibold text-slate-100"
          headerClassName=""
          closeOnOverlay={false}
          escapeKey={false}
        >
          <p className="text-sm text-slate-400 mt-2">
            This regenerates thumbnails for every non-trashed picture and replaces the existing
            ones. The worker processes one job at a time, so this can take a while on large
            libraries.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void onConfirm()
              }}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              Confirm
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

const DETECTOR_LABELS: Record<FaceDetectorKind, string> = {
  human: 'Human (BlazeFace)',
  scrfd: 'SCRFD 10G',
}

// ponytail: mirrors shared-types' FACE_DETECTOR_KINDS — vite's commonjs pass only covers
// node_modules, so a value import from the (CJS) workspace package fails the build.
// Upgrade path: add the workspace package to build.commonjsOptions.include.
const DETECTOR_KINDS = ['human', 'scrfd'] as const satisfies readonly FaceDetectorKind[]

const DETECTOR_HINTS: Record<FaceDetectorKind, string> = {
  human: 'Runs with the detector bundled in the worker.',
  scrfd: 'InsightFace SCRFD 10G — needs its model file on disk.',
}

const SCRFD_PROVISION_CMD = 'pnpm --filter @photox/worker-service face-model'
const VISION_PROVISION_CMD = 'pnpm --filter @photox/worker-service vision-model'

export function FaceDetectionSection() {
  const [data, setData] = useState<FaceDetectionSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmScrfd, setConfirmScrfd] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getFaceDetection()
      .then((res) => {
        if (cancelled) return
        setData(res)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load face detection settings')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [version])

  const applyDetector = async (detector: FaceDetectorKind) => {
    setSaving(true)
    setSaveError(null)
    try {
      setData(await setFaceDetector(detector))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not change the detector')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FaFaceSmile className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Face detection</h2>
        </div>
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          disabled={saving}
          aria-label="Refresh face detection settings"
          className="text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <FaArrowsRotate />
        </button>
      </div>

      {loading ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-5">
          <div className="h-3 w-24 rounded bg-slate-700 animate-pulse mb-4" />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="h-16 rounded-lg bg-slate-700/50 animate-pulse" />
            <div className="h-16 rounded-lg bg-slate-700/50 animate-pulse" />
          </div>
        </div>
      ) : error ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-4 text-center">
          <p className="text-xs text-red-400 mb-2">{error}</p>
          <button
            type="button"
            onClick={() => setVersion((v) => v + 1)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-5">
          <fieldset disabled={saving}>
            <legend className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">
              Active detector
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {DETECTOR_KINDS.map((kind) => {
                const selected = data.detector === kind
                const unavailable = kind === 'scrfd' && !data.models.scrfd
                const frame = selected
                  ? unavailable
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-primary/50 bg-primary/5'
                  : unavailable
                    ? 'border-border-dark opacity-60'
                    : 'border-border-dark hover:border-slate-600'
                return (
                  <label
                    key={kind}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer ${frame}`}
                  >
                    <input
                      type="radio"
                      name="face-detector"
                      value={kind}
                      checked={selected}
                      disabled={unavailable}
                      onChange={() => void applyDetector(kind)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary disabled:cursor-not-allowed"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-200">
                        {DETECTOR_LABELS[kind]}
                      </span>
                      <span className="block text-xs text-slate-400 mt-0.5">
                        {DETECTOR_HINTS[kind]}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          {saveError && <p className="text-xs text-red-400 mt-3">{saveError}</p>}

          {!data.models.scrfd && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-xs text-amber-200">
                {data.detector === 'scrfd'
                  ? 'SCRFD is selected but its model is not installed — detection jobs will fail until it is provisioned.'
                  : 'SCRFD model not installed — the SCRFD choice stays disabled until it is provisioned.'}
              </p>
              <code className="block text-xs font-mono text-amber-200/80 mt-1.5 break-all">
                {SCRFD_PROVISION_CMD}
              </code>
              {data.detector !== 'scrfd' && (
                <button
                  type="button"
                  onClick={() => setConfirmScrfd(true)}
                  className="text-xs font-medium text-amber-300 underline underline-offset-2 hover:text-amber-100 transition-colors mt-1.5"
                >
                  Switch to SCRFD anyway
                </button>
              )}
            </div>
          )}

          {data.detector !== data.envDefault && (
            <p className="text-xs text-slate-500 mt-3">
              Persisted — overrides the <code className="font-mono">FACE_DETECTOR</code> env
              default, currently {DETECTOR_LABELS[data.envDefault]}.
            </p>
          )}

          {data.facesByDetector.human > 0 && data.facesByDetector.scrfd > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mt-4">
              <FaTriangleExclamation className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200">
                Faces are mixed:{' '}
                <span className="font-semibold tabular-nums">
                  {data.facesByDetector.human.toLocaleString()}
                </span>{' '}
                with {DETECTOR_LABELS.human},{' '}
                <span className="font-semibold tabular-nums">
                  {data.facesByDetector.scrfd.toLocaleString()}
                </span>{' '}
                with {DETECTOR_LABELS.scrfd}.
                {data.facesByDetector.unset > 0 ? (
                  <>
                    {' '}
                    {data.facesByDetector.unset.toLocaleString()} more faces have no detector
                    recorded.
                  </>
                ) : null}{' '}
                Reprocess all faces below to put the library on one detector.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {confirmScrfd && (
        <Dialog
          title="Switch to SCRFD anyway?"
          onClose={() => setConfirmScrfd(false)}
          panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
          titleTag="h3"
          titleClassName="text-base font-semibold text-slate-100"
          headerClassName=""
          closeOnOverlay={false}
          escapeKey={false}
        >
          <p className="text-sm text-slate-400 mt-2">
            The SCRFD model is not installed, so SCRFD detection jobs will fail until you provision
            it.
          </p>
          <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 mt-2 break-all">
            {SCRFD_PROVISION_CMD}
          </code>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setConfirmScrfd(false)}
              className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmScrfd(false)
                void applyDetector('scrfd')
              }}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              Switch anyway
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

export function FacesReprocessSection() {
  const [status, setStatus] = useState<FaceReprocessStatus | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)
  const [clustering, setClustering] = useState(false)
  const [clusterResult, setClusterResult] = useState<string | null>(null)
  const [clusterError, setClusterError] = useState<string | null>(null)
  const [settings, setSettings] = useState<FaceDetectionSettings | null>(null)

  // best-effort: only feeds the confirm dialog's SCRFD warning; failure just skips it
  useEffect(() => {
    let cancelled = false
    getFaceDetection()
      .then((res) => {
        if (!cancelled) setSettings(res)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // ponytail: 3s poll while the faces queue drains; poll errors stay silent and stop after 5
  // consecutive failures so a broken endpoint is not hammered (re-run/remount resumes)
  useEffect(() => {
    let cancelled = false
    let timer = 0
    let failures = 0
    const tick = () => {
      getFaceReprocessStatus()
        .then((res) => {
          if (cancelled) return
          failures = 0
          setStatus(res)
          if (res.queue.waiting + res.queue.active > 0) {
            timer = window.setTimeout(tick, 3000)
          }
        })
        .catch(() => {
          if (cancelled) return
          failures += 1
          if (failures < 5) timer = window.setTimeout(tick, 3000)
        })
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [runToken])

  const onConfirm = async () => {
    setConfirming(false)
    setInFlight(true)
    setError(null)
    setResult(null)
    try {
      const res = await reprocessFaces()
      setResult(
        `Queued ${res.enqueued.toLocaleString()} face jobs for ${res.total.toLocaleString()} photos.`,
      )
      setRunToken((v) => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reprocess failed')
    } finally {
      setInFlight(false)
    }
  }

  const onRecluster = async () => {
    if (clustering) return
    setClustering(true)
    setClusterError(null)
    setClusterResult(null)
    try {
      const res = await reclusterFaces()
      setClusterResult(
        res.enqueued > 0
          ? `Clustering queued for ${res.enqueued.toLocaleString()} ${res.enqueued === 1 ? 'user' : 'users'}.`
          : 'Nothing to cluster — no faces yet.',
      )
    } catch (err) {
      setClusterError(err instanceof Error ? err.message : 'Recluster failed')
    } finally {
      setClustering(false)
    }
  }

  const lastRun = status?.lastRun ?? null
  const remaining = status ? status.queue.waiting + status.queue.active : 0
  const running = remaining > 0
  const requested = lastRun?.enqueued ?? 0
  const done = Math.max(0, Math.min(requested, requested - remaining))
  const percent = requested > 0 ? Math.round((done / requested) * 100) : 0
  const scrfdUnprovisioned = settings?.detector === 'scrfd' && !settings.models.scrfd

  return (
    <section>
      <div className="bg-card-dark border border-border-dark rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Faces</h2>
            <p className="text-xs text-slate-400 mt-1">
              Re-detect and re-embed every photo with the current detector. Clustering catches up
              automatically as jobs finish.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={inFlight || running}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              {inFlight ? (
                <>
                  <FaSpinner className="animate-spin" />
                  Enqueuing…
                </>
              ) : (
                'Reprocess all faces'
              )}
            </button>
            <button
              type="button"
              onClick={() => void onRecluster()}
              disabled={clustering}
              className="inline-flex items-center gap-2 border border-border-dark hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              {clustering && <FaSpinner className="animate-spin" />}
              Recluster users
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-2">
          Recluster re-runs grouping per user — use it when people look off after a reprocess.
        </p>

        {result && <p className="text-xs text-emerald-400 mt-3">{result}</p>}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        {status && !lastRun && !running && (
          <p className="text-xs text-slate-500 mt-3">No face reprocess runs yet.</p>
        )}

        {lastRun && (
          <div className="mt-4 rounded-lg bg-slate-900/50 p-4">
            {running && requested > 0 ? (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
                    <FaSpinner className="animate-spin text-primary" />
                    Reprocessing faces…
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {remaining.toLocaleString()} of {requested.toLocaleString()} remaining ·{' '}
                    {percent}%
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Face reprocess progress"
                  aria-valuemin={0}
                  aria-valuemax={requested}
                  aria-valuenow={done}
                  className="h-2 rounded-full bg-slate-800 overflow-hidden"
                >
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Last run {new Date(lastRun.startedAt).toLocaleString()} —{' '}
                {lastRun.enqueued.toLocaleString()} of {lastRun.total.toLocaleString()} photos
                queued with the {DETECTOR_LABELS[lastRun.detector]} detector.
              </p>
            )}
          </div>
        )}

        {clusterResult && <p className="text-xs text-emerald-400 mt-3">{clusterResult}</p>}
        {clusterError && <p className="text-xs text-red-400 mt-3">{clusterError}</p>}
      </div>

      {confirming && (
        <Dialog
          title="Reprocess all faces?"
          onClose={() => setConfirming(false)}
          panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
          titleTag="h3"
          titleClassName="text-base font-semibold text-slate-100"
          headerClassName=""
          closeOnOverlay={false}
          escapeKey={false}
        >
          <p className="text-sm text-slate-400 mt-2">
            This re-detects faces and rebuilds their embeddings for every photo, using the current
            detector. People groups rebuild themselves as jobs finish — clustering catches up
            automatically. The worker runs in the background, so large libraries take a while.
          </p>
          {scrfdUnprovisioned && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-xs text-amber-200">
                The SCRFD model isn't installed — these jobs will fail until it is provisioned.
              </p>
              <code className="block text-xs font-mono text-amber-200/80 mt-1.5 break-all">
                {SCRFD_PROVISION_CMD}
              </code>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              Confirm
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

export function EmbeddingsReprocessSection() {
  const [status, setStatus] = useState<EmbeddingReprocessStatus | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)

  // ponytail: 3s poll while the embeddings queue drains; poll errors stay silent and stop after 5
  // consecutive failures so a broken endpoint is not hammered (re-run/remount resumes)
  useEffect(() => {
    let cancelled = false
    let timer = 0
    let failures = 0
    const tick = () => {
      getEmbeddingReprocessStatus()
        .then((res) => {
          if (cancelled) return
          failures = 0
          setStatus(res)
          if (res.queue.waiting + res.queue.active > 0) {
            timer = window.setTimeout(tick, 3000)
          }
        })
        .catch(() => {
          if (cancelled) return
          failures += 1
          if (failures < 5) timer = window.setTimeout(tick, 3000)
        })
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [runToken])

  const onConfirm = async () => {
    setConfirming(false)
    setInFlight(true)
    setError(null)
    setResult(null)
    try {
      const res = await reprocessEmbeddings()
      setResult(
        `Queued ${res.enqueued.toLocaleString()} embedding jobs for ${res.total.toLocaleString()} photos.`,
      )
      setRunToken((v) => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reprocess failed')
    } finally {
      setInFlight(false)
    }
  }

  const lastRun = status?.lastRun ?? null
  const remaining = status ? status.queue.waiting + status.queue.active : 0
  const running = remaining > 0
  const requested = lastRun?.enqueued ?? 0
  const done = Math.max(0, Math.min(requested, requested - remaining))
  const percent = requested > 0 ? Math.round((done / requested) * 100) : 0

  return (
    <section>
      <div className="bg-card-dark border border-border-dark rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Semantic search</h2>
            <p className="text-xs text-slate-400 mt-1">
              Photos are embedded automatically on upload. Reprocessing re-embeds the whole library
              with the SigLIP2 vision model that powers text search and visually similar results.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={inFlight || running}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {inFlight ? (
              <>
                <FaSpinner className="animate-spin" />
                Enqueuing…
              </>
            ) : (
              'Reprocess all embeddings'
            )}
          </button>
        </div>

        <p className="text-xs text-slate-500 mt-2">
          Model files seed on install — re-provision with{' '}
          <code className="font-mono">{VISION_PROVISION_CMD}</code>.
        </p>

        {result && <p className="text-xs text-emerald-400 mt-3">{result}</p>}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        {status && !lastRun && !running && (
          <p className="text-xs text-slate-500 mt-3">No embedding reprocess runs yet.</p>
        )}

        {lastRun && (
          <div className="mt-4 rounded-lg bg-slate-900/50 p-4">
            {running && requested > 0 ? (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
                    <FaSpinner className="animate-spin text-primary" />
                    Reprocessing embeddings…
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {remaining.toLocaleString()} of {requested.toLocaleString()} remaining ·{' '}
                    {percent}%
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Embedding reprocess progress"
                  aria-valuemin={0}
                  aria-valuemax={requested}
                  aria-valuenow={done}
                  className="h-2 rounded-full bg-slate-800 overflow-hidden"
                >
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Last run {new Date(lastRun.startedAt).toLocaleString()} —{' '}
                {lastRun.enqueued.toLocaleString()} of {lastRun.total.toLocaleString()} photos
                queued with {lastRun.model}.
              </p>
            )}
          </div>
        )}
      </div>

      {confirming && (
        <Dialog
          title="Reprocess all embeddings?"
          onClose={() => setConfirming(false)}
          panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
          titleTag="h3"
          titleClassName="text-base font-semibold text-slate-100"
          headerClassName=""
          closeOnOverlay={false}
          escapeKey={false}
        >
          <p className="text-sm text-slate-400 mt-2">
            This re-embeds every non-trashed photo with the SigLIP2 vision model. Text search and
            visually similar photos update as jobs finish. The worker runs in the background, so
            large libraries take a while.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              Confirm
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

export function DetectionsReprocessSection() {
  const [status, setStatus] = useState<DetectionReprocessStatus | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)

  // ponytail: 3s poll while the detect queue drains; poll errors stay silent and stop after 5
  // consecutive failures so a broken endpoint is not hammered (re-run/remount resumes)
  useEffect(() => {
    let cancelled = false
    let timer = 0
    let failures = 0
    const tick = () => {
      getDetectionReprocessStatus()
        .then((res) => {
          if (cancelled) return
          failures = 0
          setStatus(res)
          if (res.queue.waiting + res.queue.active > 0) {
            timer = window.setTimeout(tick, 3000)
          }
        })
        .catch(() => {
          if (cancelled) return
          failures += 1
          if (failures < 5) timer = window.setTimeout(tick, 3000)
        })
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [runToken])

  const onConfirm = async () => {
    setConfirming(false)
    setInFlight(true)
    setError(null)
    setResult(null)
    try {
      const res = await reprocessDetections()
      setResult(
        `Queued ${res.enqueued.toLocaleString()} detection jobs for ${res.total.toLocaleString()} photos.`,
      )
      setRunToken((v) => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reprocess failed')
    } finally {
      setInFlight(false)
    }
  }

  const lastRun = status?.lastRun ?? null
  const remaining = status ? status.queue.waiting + status.queue.active : 0
  const running = remaining > 0
  const requested = lastRun?.enqueued ?? 0
  const done = Math.max(0, Math.min(requested, requested - remaining))
  const percent = requested > 0 ? Math.round((done / requested) * 100) : 0

  return (
    <section>
      <div className="bg-card-dark border border-border-dark rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Object detection</h2>
            <p className="text-xs text-slate-400 mt-1">
              Photos are scanned for objects automatically on upload. Reprocessing runs the YOLO
              detector over the whole library — boxes show in the viewer overlay and labels feed
              text search.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={inFlight || running}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {inFlight ? (
              <>
                <FaSpinner className="animate-spin" />
                Enqueuing…
              </>
            ) : (
              'Reprocess object detection'
            )}
          </button>
        </div>

        {result && <p className="text-xs text-emerald-400 mt-3">{result}</p>}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        {status && !lastRun && !running && (
          <p className="text-xs text-slate-500 mt-3">No detection reprocess runs yet.</p>
        )}

        {lastRun && (
          <div className="mt-4 rounded-lg bg-slate-900/50 p-4">
            {running && requested > 0 ? (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
                    <FaSpinner className="animate-spin text-primary" />
                    Detecting objects…
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {remaining.toLocaleString()} of {requested.toLocaleString()} remaining ·{' '}
                    {percent}%
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Detection reprocess progress"
                  aria-valuemin={0}
                  aria-valuemax={requested}
                  aria-valuenow={done}
                  className="h-2 rounded-full bg-slate-800 overflow-hidden"
                >
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Last run {new Date(lastRun.startedAt).toLocaleString()} —{' '}
                {lastRun.enqueued.toLocaleString()} of {lastRun.total.toLocaleString()} photos
                queued.
              </p>
            )}
          </div>
        )}
      </div>

      {confirming && (
        <Dialog
          title="Reprocess object detection?"
          onClose={() => setConfirming(false)}
          panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
          titleTag="h3"
          titleClassName="text-base font-semibold text-slate-100"
          headerClassName=""
          closeOnOverlay={false}
          escapeKey={false}
        >
          <p className="text-sm text-slate-400 mt-2">
            This runs object detection over every non-trashed photo. Boxes appear in the viewer
            overlay as jobs finish. The worker runs in the background, so large libraries take a
            while.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              Confirm
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

export function OcrReprocessSection() {
  const [status, setStatus] = useState<OcrReprocessStatus | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)

  // ponytail: 3s poll while the OCR queue drains; poll errors stay silent and stop after 5
  // consecutive failures so a broken endpoint is not hammered (re-run/remount resumes)
  useEffect(() => {
    let cancelled = false
    let timer = 0
    let failures = 0
    const tick = () => {
      getOcrReprocessStatus()
        .then((res) => {
          if (cancelled) return
          failures = 0
          setStatus(res)
          if (res.queue.waiting + res.queue.active > 0) {
            timer = window.setTimeout(tick, 3000)
          }
        })
        .catch(() => {
          if (cancelled) return
          failures += 1
          if (failures < 5) timer = window.setTimeout(tick, 3000)
        })
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [runToken])

  const onConfirm = async () => {
    setConfirming(false)
    setInFlight(true)
    setError(null)
    setResult(null)
    try {
      const res = await reprocessOcr()
      setResult(
        `Queued ${res.enqueued.toLocaleString()} OCR jobs for ${res.total.toLocaleString()} photos.`,
      )
      setRunToken((v) => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reprocess failed')
    } finally {
      setInFlight(false)
    }
  }

  const lastRun = status?.lastRun ?? null
  const remaining = status ? status.queue.waiting + status.queue.active : 0
  const running = remaining > 0
  const requested = lastRun?.enqueued ?? 0
  const done = Math.max(0, Math.min(requested, requested - remaining))
  const percent = requested > 0 ? Math.round((done / requested) * 100) : 0

  return (
    <section>
      <div className="bg-card-dark border border-border-dark rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">OCR text</h2>
            <p className="text-xs text-slate-400 mt-1">
              Photos are scanned for text automatically on upload. Reprocessing runs OCR over the
              whole library — text feeds text search.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={inFlight || running}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {inFlight ? (
              <>
                <FaSpinner className="animate-spin" />
                Enqueuing…
              </>
            ) : (
              'Reprocess OCR text'
            )}
          </button>
        </div>

        {result && <p className="text-xs text-emerald-400 mt-3">{result}</p>}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        {status && !lastRun && !running && (
          <p className="text-xs text-slate-500 mt-3">No OCR reprocess runs yet.</p>
        )}

        {lastRun && (
          <div className="mt-4 rounded-lg bg-slate-900/50 p-4">
            {running && requested > 0 ? (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
                    <FaSpinner className="animate-spin text-primary" />
                    Reading text…
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {remaining.toLocaleString()} of {requested.toLocaleString()} remaining ·{' '}
                    {percent}%
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="OCR reprocess progress"
                  aria-valuemin={0}
                  aria-valuemax={requested}
                  aria-valuenow={done}
                  className="h-2 rounded-full bg-slate-800 overflow-hidden"
                >
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Last run {new Date(lastRun.startedAt).toLocaleString()} —{' '}
                {lastRun.enqueued.toLocaleString()} of {lastRun.total.toLocaleString()} photos
                queued.
              </p>
            )}
          </div>
        )}
      </div>

      {confirming && (
        <Dialog
          title="Reprocess OCR text?"
          onClose={() => setConfirming(false)}
          panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
          titleTag="h3"
          titleClassName="text-base font-semibold text-slate-100"
          headerClassName=""
          closeOnOverlay={false}
          escapeKey={false}
        >
          <p className="text-sm text-slate-400 mt-2">
            This runs OCR over every non-trashed photo. Extracted text feeds text search as jobs
            finish. The worker runs in the background, so large libraries take a while.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              Confirm
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

function OrphanCleanupSection() {
  const [data, setData] = useState<{ orphanFiles: number; orphanThumbnails: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getOrphanCounts()
      .then((res) => {
        if (cancelled) return
        setData(res)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load orphan counts')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [version])

  const runCleanup = async () => {
    setConfirming(false)
    setInFlight(true)
    setError(null)
    setResult(null)
    try {
      await cleanupOrphans()
      setResult('Cleanup job enqueued — check worker logs for details.')
      setVersion((v) => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cleanup failed')
    } finally {
      setInFlight(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FaTrashCan className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Orphan cleanup</h2>
        </div>
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          disabled={inFlight}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <FaArrowsRotate />
        </button>
      </div>
      <div className="bg-card-dark border border-border-dark rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-slate-400">
              Files and thumbnail rows in storage not referenced by any asset.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={inFlight || (data?.orphanFiles === 0 && data?.orphanThumbnails === 0)}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {inFlight ? <FaSpinner className="animate-spin" /> : null}
            Clean up
          </button>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-4 mt-4">
            <SkeletonCard tileCount={2} />
          </div>
        ) : error ? (
          <p className="text-xs text-red-400 mt-3">{error}</p>
        ) : data ? (
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-slate-900/50 rounded-lg p-4 text-center">
              <span
                className={`text-2xl font-bold tabular-nums ${data.orphanFiles > 0 ? 'text-red-400' : 'text-slate-500'}`}
              >
                {data.orphanFiles.toLocaleString()}
              </span>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">
                Orphan files
              </p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4 text-center">
              <span
                className={`text-2xl font-bold tabular-nums ${data.orphanThumbnails > 0 ? 'text-red-400' : 'text-slate-500'}`}
              >
                {data.orphanThumbnails.toLocaleString()}
              </span>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">
                Orphan thumbnails
              </p>
            </div>
          </div>
        ) : null}
        {result && <p className="text-xs text-emerald-400 mt-3">{result}</p>}
      </div>

      {confirming && (
        <Dialog
          title="Run orphan cleanup?"
          onClose={() => setConfirming(false)}
          panelClassName="bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full"
          titleTag="h3"
          titleClassName="text-base font-semibold text-slate-100"
          headerClassName=""
          closeOnOverlay={false}
          escapeKey={false}
        >
          <p className="text-sm text-slate-400 mt-2">
            This scans all files and thumbnails, then deletes anything not referenced by an asset.
            The worker processes this in the background.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm font-medium text-slate-300 hover:text-slate-100 rounded-lg px-3 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void runCleanup()}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              Confirm
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

function AdminPageContent() {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [offset, setOffset] = useState(0)
  const [version, setVersion] = useState(0)
  const [data, setData] = useState<AdminUserListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setOffset(0)
  }, [debouncedQ, sort])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params: ListAdminUsersParams = {
      limit: DEFAULT_LIMIT,
      offset,
      sortField: sort.field,
      sortDir: sort.dir,
    }
    if (debouncedQ) params.q = debouncedQ
    listAdminUsers(params)
      .then((res) => {
        if (cancelled) return
        setData(res)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load users')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQ, sort, offset, version])

  const total = data?.total ?? 0
  const currentPage = Math.floor(offset / DEFAULT_LIMIT) + 1
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_LIMIT))
  const items = data?.items ?? []

  const onSort = (field: AdminUserSortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { field, dir: field === 'createdAt' || field === 'email' ? 'desc' : 'asc' }
    })
  }

  return (
    <div className="space-y-6">
      <LibraryStatsSection />
      <AssetHealthSection />
      <ThumbnailReprocessSection />
      <FaceDetectionSection />
      <FacesReprocessSection />
      <EmbeddingsReprocessSection />
      <DetectionsReprocessSection />
      <OcrReprocessSection />
      <OrphanCleanupSection />

      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <FaUserShield className="text-2xl text-primary" />
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Users</h1>
          <span className="text-xs font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
            Admin only
          </span>
        </div>
        <div className="relative w-full sm:w-72">
          <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or email…"
            className="w-full bg-card-dark border border-border-dark focus:border-primary/50 focus:ring-0 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-colors"
          />
        </div>
      </header>

      {loading ? (
        <LoadingState className="flex items-center justify-center py-24" />
      ) : error ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-6 text-center">
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <button
            type="button"
            onClick={() => setVersion((v) => v + 1)}
            className="text-sm font-medium text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card-dark border border-border-dark rounded-xl p-12 text-center">
          <p className="text-slate-400">No users match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="bg-card-dark border border-border-dark rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/50 text-xs uppercase text-slate-400 tracking-wider">
                <tr>
                  <SortHeader field="displayName" label="Name" sort={sort} onSort={onSort} />
                  <SortHeader field="email" label="Email" sort={sort} onSort={onSort} />
                  <SortHeader field="role" label="Role" sort={sort} onSort={onSort} />
                  <SortHeader field="createdAt" label="Created" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark">
                {items.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-slate-100">{u.displayName}</td>
                    <td className="px-4 py-3 text-slate-300">{u.email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="flex items-center justify-between text-sm text-slate-400">
            <span>
              {total.toLocaleString()} {total === 1 ? 'user' : 'users'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - DEFAULT_LIMIT))}
                className="px-3 py-1.5 rounded-lg bg-card-dark border border-border-dark text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
              >
                Prev
              </button>
              <span className="px-2 tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + DEFAULT_LIMIT)}
                className="px-3 py-1.5 rounded-lg bg-card-dark border border-border-dark text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
              >
                Next
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  )
}

interface SortHeaderProps {
  field: AdminUserSortField
  label: string
  sort: SortState
  onSort: (field: AdminUserSortField) => void
}

function SortHeader({ field, label, sort, onSort }: SortHeaderProps) {
  const active = sort.field === field
  const Icon = !active ? FaArrowsUpDown : sort.dir === 'asc' ? FaArrowUp : FaArrowDown
  return (
    <th className="text-left font-semibold px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1.5 hover:text-slate-100 transition-colors"
      >
        {label}
        <Icon className={`text-[10px] ${active ? 'text-primary' : 'text-slate-500'}`} />
      </button>
    </th>
  )
}

function RoleBadge({ role }: { role: 'user' | 'admin' }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
        <FaUserShield className="text-[10px]" />
        admin
      </span>
    )
  }
  return (
    <span className="inline-flex items-center text-xs font-medium text-slate-300 bg-slate-700/40 border border-slate-600/40 rounded-full px-2 py-0.5">
      user
    </span>
  )
}

export default function AdminPage() {
  return (
    <RequireAuth>
      <RequireAdmin>
        <AppShell>
          <AdminPageContent />
        </AppShell>
      </RequireAdmin>
    </RequireAuth>
  )
}
