import { useEffect, useState, type ReactNode } from 'react'
import {
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpDown,
  FaArrowsRotate,
  FaBrain,
  FaCamera,
  FaCircleCheck,
  FaFaceSmile,
  FaFilm,
  FaFont,
  FaMagnifyingGlass,
  FaObjectGroup,
  FaSpinner,
  FaTrashCan,
  FaTriangleExclamation,
  FaUser,
  FaUserShield,
  FaWandMagicSparkles,
} from 'react-icons/fa6'
import {
  type AdminUserListResponse,
  type AdminUserSortField,
  type AdminAssetCountsResponse,
  type FaceDetectionSettings,
  type FaceDetectorKind,
} from '@photox/shared-types'
import { RequireAuth } from '../../components/RequireAuth'
import { RequireAdmin } from '../../components/RequireAdmin'
import { AppShell } from '../../components/AppShell'
import { Dialog } from '../../components/Dialog'
import { LoadingState } from '../../components/StateViews'
import { LibraryStatsSection } from './library-stats'
import {
  AdminCard,
  AdminSection,
  AdminToast,
  GhostButton,
  PrimaryButton,
  ProgressBar,
  StatStrip,
  StatusPill,
  cx,
} from './ui'
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

type SortDir = 'asc' | 'desc'

interface SortState {
  field: AdminUserSortField
  dir: SortDir
}

const DEFAULT_SORT: SortState = { field: 'createdAt', dir: 'desc' }
const DEFAULT_LIMIT = 20

const DIALOG_PANEL_CLASS = 'bg-card-dark border border-border-dark rounded-xl p-5 max-w-md w-full'
const DIALOG_TITLE_CLASS = 'text-base font-semibold text-slate-100'

// --- small shared pieces ----------------------------------------------------------------

/** Icon-only refresh; PrimaryButton/GhostButton require children, so this stays raw. */
function RefreshButton({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <FaArrowsRotate />
    </button>
  )
}

function FailureTile({ count, label }: { count: number; label: string }) {
  return (
    <div className="text-center">
      <span
        className={cx(
          'text-2xl font-bold tabular-nums',
          count > 0 ? 'text-status-error' : 'text-on-surface-variant',
        )}
      >
        {count.toLocaleString()}
      </span>
      <p className="text-label-xs uppercase font-mono text-outline mt-1">{label}</p>
    </div>
  )
}

interface MatrixPanelProps {
  title: string
  icon: typeof FaCamera
  tiles: { count: number; label: string }[]
}

function MatrixPanel({ title, icon: Icon, tiles }: MatrixPanelProps) {
  const colClass = tiles.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
  return (
    <div className="bg-surface-container rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="text-outline text-xs" />
        <span className="text-label-sm text-on-surface">{title}</span>
      </div>
      <div className={`grid ${colClass} gap-2`}>
        {tiles.map((t) => (
          <FailureTile key={t.label} count={t.count} label={t.label} />
        ))}
      </div>
    </div>
  )
}

function SkeletonPanel({ tileCount = 4 }: { tileCount?: number }) {
  const colClass = tileCount === 2 ? 'grid-cols-2' : tileCount === 3 ? 'grid-cols-3' : 'grid-cols-4'
  return (
    <div className="bg-surface-container rounded-lg p-4">
      <div className="h-3 w-32 rounded bg-surface-container-high animate-pulse mb-4" />
      <div className={`grid ${colClass} gap-2`}>
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

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-2 text-center">
      <p className="text-xs text-status-error mb-2">{message}</p>
      <GhostButton onClick={onRetry}>Retry</GhostButton>
    </div>
  )
}

/**
 * SectionCard mirror with a header `actions` slot — the two maintenance cards need a refresh
 * button next to their title and ui.tsx's SectionCard doesn't expose one. Kept local on purpose:
 * ui.tsx is shared with other lanes, so extend the primitive only when a third caller needs it.
 */
function ActionCard({
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  icon: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <AdminCard>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-lg text-outline">{icon}</span>
          <div>
            <h3 className="text-headline-lg text-on-surface">{title}</h3>
            {subtitle && <p className="text-body-sm text-outline">{subtitle}</p>}
          </div>
        </div>
        {actions != null && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </AdminCard>
  )
}

interface ModelCardHeaderProps {
  icon: typeof FaBrain
  title: string
  chip?: string
  tone: 'ok' | 'warn' | 'muted'
  statusLabel: string
}

function ModelCardHeader({ icon: Icon, title, chip, tone, statusLabel }: ModelCardHeaderProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="w-10 h-10 shrink-0 rounded-lg bg-surface-container-highest flex items-center justify-center">
        <Icon className="text-on-surface-variant" />
      </span>
      <h3 className="text-[17px] font-semibold text-on-surface mr-auto">{title}</h3>
      <StatusPill tone={tone}>{statusLabel}</StatusPill>
      {chip ? (
        <span className="font-mono text-xs px-2 py-1 rounded bg-surface-container text-on-surface-variant">
          {chip}
        </span>
      ) : null}
    </div>
  )
}

// --- facial detection & clustering ------------------------------------------------------

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

/** The merged detector + reprocess card. `parts` narrows it for the two legacy exports below. */
function FacialDetectionCard({ parts = 'both' }: { parts?: 'both' | 'detector' | 'reprocess' }) {
  const showDetector = parts !== 'reprocess'
  const showReprocess = parts !== 'detector'

  const [data, setData] = useState<FaceDetectionSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmScrfd, setConfirmScrfd] = useState(false)

  const [status, setStatus] = useState<FaceReprocessStatus | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [reprocessError, setReprocessError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)
  const [clustering, setClustering] = useState(false)
  const [clusterResult, setClusterResult] = useState<string | null>(null)
  const [clusterError, setClusterError] = useState<string | null>(null)

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

  // ponytail: 3s poll while the faces queue drains; poll errors stay silent and stop after 5
  // consecutive failures so a broken endpoint is not hammered (re-run/remount resumes)
  useEffect(() => {
    if (!showReprocess) return
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
  }, [runToken, showReprocess])

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

  const onConfirm = async () => {
    setConfirming(false)
    setInFlight(true)
    setReprocessError(null)
    setResult(null)
    try {
      const res = await reprocessFaces()
      setResult(
        `Queued ${res.enqueued.toLocaleString()} face jobs for ${res.total.toLocaleString()} photos.`,
      )
      setRunToken((v) => v + 1)
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : 'Reprocess failed')
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
  const runQueue = status ? status.queue.waiting + status.queue.active : 0
  const running = runQueue > 0
  const requested = lastRun?.enqueued ?? 0
  const done = Math.max(0, Math.min(requested, requested - runQueue))
  const percent = requested > 0 ? Math.round((done / requested) * 100) : 0
  const scrfdUnprovisioned = data?.detector === 'scrfd' && !data.models.scrfd

  const pillTone: 'ok' | 'warn' | 'muted' = error
    ? 'muted'
    : loading
      ? 'muted'
      : scrfdUnprovisioned
        ? 'warn'
        : 'ok'
  const pillLabel = error
    ? 'Unavailable'
    : loading || !data
      ? 'Checking…'
      : scrfdUnprovisioned
        ? 'Model missing'
        : 'Online'

  const statRows: { label: string; value: ReactNode }[] = []
  if (showDetector)
    statRows.push({ label: 'Detector', value: data ? DETECTOR_LABELS[data.detector] : '—' })
  if (showReprocess) {
    statRows.push({
      label: 'Queue',
      value: status ? (running ? runQueue.toLocaleString() : 'Idle') : '—',
    })
  }

  return (
    <AdminCard className="flex flex-col">
      <ModelCardHeader
        icon={FaFaceSmile}
        title="Facial Detection & Clustering"
        chip={data ? DETECTOR_LABELS[data.detector] : '—'}
        tone={pillTone}
        statusLabel={pillLabel}
      />

      <p className="text-body-sm text-on-surface-variant mt-4">
        Re-detect and re-embed every photo with the current detector. Clustering catches up
        automatically as jobs finish.
      </p>

      {showDetector &&
        (loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
            <div className="h-16 rounded-lg bg-surface-container-high/50 animate-pulse" />
            <div className="h-16 rounded-lg bg-surface-container-high/50 animate-pulse" />
          </div>
        ) : error ? (
          <InlineError message={error} onRetry={() => setVersion((v) => v + 1)} />
        ) : data ? (
          <div className="mt-4">
            <fieldset disabled={saving}>
              <legend className="text-label-xs uppercase font-mono text-outline mb-2">
                Active detector
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DETECTOR_KINDS.map((kind) => {
                  const selected = data.detector === kind
                  const unavailable = kind === 'scrfd' && !data.models.scrfd
                  return (
                    <label
                      key={kind}
                      className={cx(
                        'flex items-start gap-3 rounded-lg p-3 transition-colors',
                        selected
                          ? 'bg-primary/10 border-2 border-primary/40'
                          : 'bg-surface-container hover:bg-surface-container-high border border-transparent',
                        unavailable ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
                      )}
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
                        <span className="block text-sm font-medium text-on-surface">
                          {DETECTOR_LABELS[kind]}
                        </span>
                        <span className="block text-xs text-on-surface-variant mt-0.5">
                          {DETECTOR_HINTS[kind]}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {saveError && <p className="text-xs text-status-error mt-2">{saveError}</p>}

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
              <p className="text-xs text-outline mt-3">
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
        ) : null)}

      {showReprocess && (
        <>
          {status && !lastRun && !running && (
            <p className="text-xs font-mono text-outline mt-3">No face reprocess runs yet.</p>
          )}

          {running && requested > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <span className="inline-flex items-center gap-2 text-xs font-medium text-on-surface">
                  <FaSpinner className="animate-spin text-primary" />
                  Reprocessing faces…
                </span>
                <span className="text-xs tabular-nums text-on-surface-variant">
                  {runQueue.toLocaleString()} of {requested.toLocaleString()} remaining · {percent}%
                </span>
              </div>
              <ProgressBar value={done} max={requested} label="Face reprocess progress" />
            </div>
          )}

          {lastRun && !running && (
            <p className="text-xs font-mono text-outline mt-3">
              Last run {new Date(lastRun.startedAt).toLocaleString()} —{' '}
              {lastRun.enqueued.toLocaleString()} of {lastRun.total.toLocaleString()} photos queued
              with the {DETECTOR_LABELS[lastRun.detector]} detector.
            </p>
          )}

          {result && <AdminToast message={result} />}
          {reprocessError && <AdminToast message={reprocessError} tone="error" />}
          {clusterResult && <AdminToast message={clusterResult} />}
          {clusterError && <AdminToast message={clusterError} tone="error" />}
        </>
      )}

      <div className="mt-auto pt-5">
        <StatStrip rows={statRows} />
        <div className="mt-4 border-t border-border-dark/40 pt-4 flex items-center justify-between gap-3 flex-wrap">
          <RefreshButton
            onClick={() => setVersion((v) => v + 1)}
            label="Refresh face detection settings"
            disabled={saving}
          />
          {showReprocess && (
            <div className="flex items-center gap-2 flex-wrap ml-auto">
              <GhostButton
                onClick={() => void onRecluster()}
                disabled={clustering}
                icon={clustering ? <FaSpinner className="animate-spin" /> : undefined}
              >
                Recluster users
              </GhostButton>
              <PrimaryButton
                onClick={() => setConfirming(true)}
                disabled={inFlight || running}
                icon={inFlight ? <FaSpinner className="animate-spin" /> : undefined}
              >
                {inFlight ? 'Enqueuing…' : 'Reprocess all faces'}
              </PrimaryButton>
            </div>
          )}
        </div>
      </div>

      {confirmScrfd && (
        <Dialog
          title="Switch to SCRFD anyway?"
          onClose={() => setConfirmScrfd(false)}
          panelClassName={DIALOG_PANEL_CLASS}
          titleTag="h3"
          titleClassName={DIALOG_TITLE_CLASS}
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

      {confirming && (
        <Dialog
          title="Reprocess all faces?"
          onClose={() => setConfirming(false)}
          panelClassName={DIALOG_PANEL_CLASS}
          titleTag="h3"
          titleClassName={DIALOG_TITLE_CLASS}
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
    </AdminCard>
  )
}

/** Kept for face-detection.spec.tsx — the page mounts the merged card above. */
export function FaceDetectionSection() {
  return <FacialDetectionCard parts="detector" />
}

/** Kept for face-detection.spec.tsx — the page mounts the merged card above. */
export function FacesReprocessSection() {
  return <FacialDetectionCard parts="reprocess" />
}

// --- single-pipeline model cards (embeddings / detections / OCR) ------------------------

interface QueueCounts {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

interface ReprocessRun {
  startedAt: string
  total: number
  enqueued: number
}

interface StatRow {
  label: string
  value: ReactNode
  tone?: 'default' | 'muted'
}

interface ReprocessPipeline<L extends ReprocessRun> {
  icon: typeof FaBrain
  title: string
  chip?: string
  prose: string
  note?: ReactNode
  emptyLabel: string
  runningLabel: string
  progressLabel: string
  buttonLabel: string
  dialogTitle: string
  dialogBody: string
  getStatus: () => Promise<{ lastRun: L | null; queue: QueueCounts }>
  reprocess: () => Promise<{ enqueued: number; total: number }>
  resultText: (res: { enqueued: number; total: number }) => string
  statRows: (status: { lastRun: L | null; queue: QueueCounts } | null) => StatRow[]
}

function queueValue(status: { queue: QueueCounts } | null): string {
  if (!status) return '—'
  const depth = status.queue.waiting + status.queue.active
  return depth > 0 ? depth.toLocaleString() : 'Idle'
}

function lastRunValue(lastRun: ReprocessRun | null): string {
  return lastRun ? new Date(lastRun.startedAt).toLocaleString() : '—'
}

function ReprocessPipelineCard<L extends ReprocessRun>({
  pipeline,
}: {
  pipeline: ReprocessPipeline<L>
}) {
  const { getStatus, reprocess, resultText } = pipeline
  const [status, setStatus] = useState<{ lastRun: L | null; queue: QueueCounts } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)

  // ponytail: 3s poll while the queue drains; poll errors stay silent and stop after 5
  // consecutive failures so a broken endpoint is not hammered (re-run/remount resumes)
  useEffect(() => {
    let cancelled = false
    let timer = 0
    let failures = 0
    const tick = () => {
      getStatus()
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
  }, [getStatus, runToken])

  const onConfirm = async () => {
    setConfirming(false)
    setInFlight(true)
    setError(null)
    setResult(null)
    try {
      const res = await reprocess()
      setResult(resultText(res))
      setRunToken((v) => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reprocess failed')
    } finally {
      setInFlight(false)
    }
  }

  const lastRun = status?.lastRun ?? null
  const runQueue = status ? status.queue.waiting + status.queue.active : 0
  const running = runQueue > 0
  const requested = lastRun?.enqueued ?? 0
  const done = Math.max(0, Math.min(requested, requested - runQueue))
  const percent = requested > 0 ? Math.round((done / requested) * 100) : 0

  return (
    <AdminCard className="flex flex-col">
      <ModelCardHeader
        icon={pipeline.icon}
        title={pipeline.title}
        chip={pipeline.chip}
        tone={status ? 'ok' : 'muted'}
        statusLabel={status ? 'Online' : 'Checking…'}
      />

      <p className="text-body-sm text-on-surface-variant mt-4">{pipeline.prose}</p>
      {pipeline.note && <p className="text-xs font-mono text-outline mt-2">{pipeline.note}</p>}

      {status && !lastRun && !running && (
        <p className="text-xs font-mono text-outline mt-3">{pipeline.emptyLabel}</p>
      )}

      {running && requested > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-on-surface">
              <FaSpinner className="animate-spin text-primary" />
              {pipeline.runningLabel}
            </span>
            <span className="text-xs tabular-nums text-on-surface-variant">
              {runQueue.toLocaleString()} of {requested.toLocaleString()} remaining · {percent}%
            </span>
          </div>
          <ProgressBar value={done} max={requested} label={pipeline.progressLabel} />
        </div>
      )}

      {lastRun && !running && (
        <p className="text-xs font-mono text-outline mt-3">
          Last run {new Date(lastRun.startedAt).toLocaleString()} —{' '}
          {lastRun.enqueued.toLocaleString()} of {lastRun.total.toLocaleString()} photos queued.
        </p>
      )}

      {result && <AdminToast message={result} />}
      {error && <AdminToast message={error} tone="error" />}

      <div className="mt-auto pt-5">
        <StatStrip rows={pipeline.statRows(status)} />
        <div className="mt-4 border-t border-border-dark/40 pt-4 flex justify-end">
          <PrimaryButton
            onClick={() => setConfirming(true)}
            disabled={inFlight || running}
            icon={inFlight ? <FaSpinner className="animate-spin" /> : undefined}
          >
            {inFlight ? 'Enqueuing…' : pipeline.buttonLabel}
          </PrimaryButton>
        </div>
      </div>

      {confirming && (
        <Dialog
          title={pipeline.dialogTitle}
          onClose={() => setConfirming(false)}
          panelClassName={DIALOG_PANEL_CLASS}
          titleTag="h3"
          titleClassName={DIALOG_TITLE_CLASS}
          headerClassName=""
          closeOnOverlay={false}
          escapeKey={false}
        >
          <p className="text-sm text-slate-400 mt-2">{pipeline.dialogBody}</p>
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
    </AdminCard>
  )
}

// Brief said chip/label = "Embedding dim 512" via FACE_EMBEDDING_DIM; 512 is the *face* embedding
// (ArcFace). This card re-embeds with SigLIP2, whose dim is 768 in SEARCH_EMBEDDING_DIM — label it
// with the model it actually runs.
// ponytail: the dim is mirrored, not imported — vite's commonjs pass only covers node_modules, so
// a value import from the (CJS) workspace package fails the build. Upgrade path: add the workspace
// package to build.commonjsOptions.include.
const SEARCH_EMBEDDING_DIM = 768

const EMBEDDINGS_PIPELINE: ReprocessPipeline<NonNullable<EmbeddingReprocessStatus['lastRun']>> = {
  icon: FaWandMagicSparkles,
  title: 'Semantic Search',
  chip: `Embedding dim ${SEARCH_EMBEDDING_DIM}`,
  prose:
    'Photos are embedded automatically on upload. Reprocessing re-embeds the whole library with the SigLIP2 vision model that powers text search and visually similar results.',
  note: (
    <>
      Model files seed on install — re-provision with{' '}
      <code className="font-mono">{VISION_PROVISION_CMD}</code>.
    </>
  ),
  emptyLabel: 'No embedding reprocess runs yet.',
  runningLabel: 'Reprocessing embeddings…',
  progressLabel: 'Embedding reprocess progress',
  buttonLabel: 'Reprocess all embeddings',
  dialogTitle: 'Reprocess all embeddings?',
  dialogBody:
    'This re-embeds every non-trashed photo with the SigLIP2 vision model. Text search and visually similar photos update as jobs finish. The worker runs in the background, so large libraries take a while.',
  getStatus: () => getEmbeddingReprocessStatus(),
  reprocess: () => reprocessEmbeddings(),
  resultText: (res) =>
    `Queued ${res.enqueued.toLocaleString()} embedding jobs for ${res.total.toLocaleString()} photos.`,
  statRows: (status) => [
    { label: 'Embedding dim', value: SEARCH_EMBEDDING_DIM },
    { label: 'Last run', value: lastRunValue(status?.lastRun ?? null) },
  ],
}

const DETECTIONS_PIPELINE: ReprocessPipeline<NonNullable<DetectionReprocessStatus['lastRun']>> = {
  icon: FaObjectGroup,
  title: 'Object & Scene Segmentation',
  prose:
    'Photos are scanned for objects automatically on upload. Reprocessing runs the YOLO detector over the whole library — boxes show in the viewer overlay and labels feed text search.',
  emptyLabel: 'No detection reprocess runs yet.',
  runningLabel: 'Detecting objects…',
  progressLabel: 'Detection reprocess progress',
  buttonLabel: 'Reprocess object detection',
  dialogTitle: 'Reprocess object detection?',
  dialogBody:
    'This runs object detection over every non-trashed photo. Boxes appear in the viewer overlay as jobs finish. The worker runs in the background, so large libraries take a while.',
  getStatus: () => getDetectionReprocessStatus(),
  reprocess: () => reprocessDetections(),
  resultText: (res) =>
    `Queued ${res.enqueued.toLocaleString()} detection jobs for ${res.total.toLocaleString()} photos.`,
  statRows: (status) => [
    { label: 'Last run', value: lastRunValue(status?.lastRun ?? null) },
    { label: 'Queue', value: queueValue(status) },
  ],
}

const OCR_PIPELINE: ReprocessPipeline<NonNullable<OcrReprocessStatus['lastRun']>> = {
  icon: FaFont,
  title: 'Text Extraction (OCR)',
  prose:
    'Photos are scanned for text automatically on upload. Reprocessing runs OCR over the whole library — text feeds text search.',
  emptyLabel: 'No OCR reprocess runs yet.',
  runningLabel: 'Reading text…',
  progressLabel: 'OCR reprocess progress',
  buttonLabel: 'Reprocess OCR text',
  dialogTitle: 'Reprocess OCR text?',
  dialogBody:
    'This runs OCR over every non-trashed photo. Extracted text feeds text search as jobs finish. The worker runs in the background, so large libraries take a while.',
  getStatus: () => getOcrReprocessStatus(),
  reprocess: () => reprocessOcr(),
  resultText: (res) =>
    `Queued ${res.enqueued.toLocaleString()} OCR jobs for ${res.total.toLocaleString()} photos.`,
  statRows: (status) => [
    { label: 'Last run', value: lastRunValue(status?.lastRun ?? null) },
    { label: 'Queue', value: queueValue(status) },
  ],
}

export function EmbeddingsReprocessSection() {
  return <ReprocessPipelineCard pipeline={EMBEDDINGS_PIPELINE} />
}

export function DetectionsReprocessSection() {
  return <ReprocessPipelineCard pipeline={DETECTIONS_PIPELINE} />
}

export function OcrReprocessSection() {
  return <ReprocessPipelineCard pipeline={OCR_PIPELINE} />
}

// --- asset health & queues (merges the counts matrix + thumbnail reprocess) -------------

function AssetHealthSection() {
  const [data, setData] = useState<AdminAssetCountsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [reprocessError, setReprocessError] = useState<string | null>(null)

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
    <ActionCard
      title="Asset Health & Pipeline Queues"
      icon={<FaTriangleExclamation />}
      actions={
        <RefreshButton onClick={() => setVersion((v) => v + 1)} label="Refresh asset health" />
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
        <PrimaryButton
          onClick={() => setConfirming(true)}
          disabled={inFlight}
          icon={inFlight ? <FaSpinner className="animate-spin" /> : undefined}
        >
          {inFlight ? 'Enqueuing…' : 'Reprocess pictures'}
        </PrimaryButton>
      </div>

      {result && <AdminToast message={result} />}
      {reprocessError && <AdminToast message={reprocessError} tone="error" />}

      {confirming && (
        <Dialog
          title="Reprocess all pictures?"
          onClose={() => setConfirming(false)}
          panelClassName={DIALOG_PANEL_CLASS}
          titleTag="h3"
          titleClassName={DIALOG_TITLE_CLASS}
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
              onClick={() => void onConfirm()}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              Confirm
            </button>
          </div>
        </Dialog>
      )}
    </ActionCard>
  )
}

// --- orphan cleanup ---------------------------------------------------------------------

function OrphanCountTile({ count, label }: { count: number; label: string }) {
  return (
    <div className="bg-surface-container rounded-lg p-4 text-center">
      <span
        className={cx(
          'text-2xl font-bold tabular-nums',
          count > 0 ? 'text-status-error' : 'text-on-surface-variant',
        )}
      >
        {count.toLocaleString()}
      </span>
      <p className="text-label-xs uppercase font-mono text-outline mt-1">{label}</p>
    </div>
  )
}

function OrphanCleanupSection() {
  const [data, setData] = useState<{ orphanFiles: number; orphanThumbnails: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
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
    setRunError(null)
    setResult(null)
    try {
      await cleanupOrphans()
      setResult('Cleanup job enqueued — check worker logs for details.')
      setVersion((v) => v + 1)
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Cleanup failed')
    } finally {
      setInFlight(false)
    }
  }

  const empty = data?.orphanFiles === 0 && data?.orphanThumbnails === 0

  return (
    <ActionCard
      title="Orphan Cleanup"
      subtitle="Files and thumbnails in storage that no asset references."
      icon={<FaTrashCan />}
      actions={
        <RefreshButton
          onClick={() => setVersion((v) => v + 1)}
          label="Refresh orphan counts"
          disabled={inFlight}
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
            <OrphanCountTile count={data.orphanFiles} label="Orphan files" />
            <OrphanCountTile count={data.orphanThumbnails} label="Orphan thumbnails" />
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

      <div className="border-t border-border-dark/40 pt-4 mt-4 flex justify-end">
        <PrimaryButton
          onClick={() => setConfirming(true)}
          disabled={inFlight || empty}
          icon={inFlight ? <FaSpinner className="animate-spin" /> : undefined}
        >
          Clean up
        </PrimaryButton>
      </div>

      {result && <AdminToast message={result} />}
      {runError && <AdminToast message={runError} tone="error" />}

      {confirming && (
        <Dialog
          title="Run orphan cleanup?"
          onClose={() => setConfirming(false)}
          panelClassName={DIALOG_PANEL_CLASS}
          titleTag="h3"
          titleClassName={DIALOG_TITLE_CLASS}
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
    </ActionCard>
  )
}

// --- users ------------------------------------------------------------------------------

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
        className="inline-flex items-center gap-1.5 hover:text-on-surface transition-colors"
      >
        {label}
        <Icon className={cx('text-[10px]', active ? 'text-primary' : 'text-outline')} />
      </button>
    </th>
  )
}

function RoleBadge({ role }: { role: 'user' | 'admin' }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300 bg-amber-500/10 rounded-full px-2 py-0.5">
        <FaUserShield className="text-[10px]" />
        admin
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-on-surface-variant bg-surface-container-highest rounded-full px-2 py-0.5">
      <FaUser className="text-[10px]" />
      user
    </span>
  )
}

export function UsersSection() {
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
    <AdminSection
      title="Users Management"
      subtitle="Manage roles for accounts on this instance"
      icon={
        <span className="w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center">
          <FaUserShield className="text-primary text-sm" />
        </span>
      }
      actions={
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill tone="warn">Admin only</StatusPill>
          <div className="relative w-full sm:w-72">
            <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-xs" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or email…"
              aria-label="Search users"
              className="w-full bg-surface-container border border-border-dark focus:border-primary/50 focus:ring-1 focus:ring-primary outline-none rounded-lg pl-9 pr-3 py-2 text-xs text-on-surface placeholder-outline transition-colors"
            />
          </div>
        </div>
      }
    >
      {loading ? (
        <LoadingState className="flex items-center justify-center py-24" />
      ) : error ? (
        <AdminCard className="text-center">
          <p className="text-sm text-status-error mb-3">{error}</p>
          <GhostButton onClick={() => setVersion((v) => v + 1)}>Retry</GhostButton>
        </AdminCard>
      ) : items.length === 0 ? (
        <AdminCard className="p-12 text-center">
          <p className="text-on-surface-variant">No users match the current filters.</p>
        </AdminCard>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface-container-low">
          <table className="w-full text-xs">
            <thead className="bg-surface-container text-on-surface-variant font-mono text-label-xs uppercase tracking-wider">
              <tr>
                <SortHeader field="displayName" label="User" sort={sort} onSort={onSort} />
                <SortHeader field="email" label="Email" sort={sort} onSort={onSort} />
                <SortHeader field="role" label="Role" sort={sort} onSort={onSort} />
                <SortHeader field="createdAt" label="Created" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dark">
              {items.map((u) => (
                <tr key={u.id} className="hover:bg-surface-container/50 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 shrink-0 rounded-full bg-surface-container-highest text-on-surface-variant text-[11px] font-bold flex items-center justify-center">
                        {u.displayName.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="text-on-surface font-medium truncate">{u.displayName}</p>
                        <p className="font-mono text-[10px] text-outline truncate">{u.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-on-surface-variant">{u.email}</td>
                  <td className="py-3.5 px-4">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="py-3.5 px-4 font-mono text-outline">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <footer className="bg-surface-container px-4 py-3 flex items-center justify-between text-xs text-outline font-mono">
            <span>Showing {total.toLocaleString()} registered user(s)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - DEFAULT_LIMIT))}
                className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-dark text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
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
                className="px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-dark text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 transition-colors"
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      )}
    </AdminSection>
  )
}

// --- page -------------------------------------------------------------------------------

function AdminPageContent() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-headline-xl text-on-surface tracking-tight">Admin Console</h1>
        <p className="text-body-sm text-on-surface-variant mt-1">
          System telemetry, worker pipelines, face inference, and instance user management.
        </p>
      </header>

      <LibraryStatsSection />

      <AdminSection
        title="Machine Learning Models & Inference"
        subtitle="Vision embeddings, facial clustering, object detection, and OCR pipelines."
        icon={<FaBrain />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FacialDetectionCard />
          <EmbeddingsReprocessSection />
          <DetectionsReprocessSection />
          <OcrReprocessSection />
        </div>
      </AdminSection>

      <AdminSection
        title="Asset Health & Maintenance"
        subtitle="Queue depths across the transcoder and thumbnail generator."
        icon={<FaCircleCheck />}
      >
        <div className="space-y-6">
          <AssetHealthSection />
          <OrphanCleanupSection />
        </div>
      </AdminSection>

      <UsersSection />
    </div>
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
