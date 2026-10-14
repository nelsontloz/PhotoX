import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  FaBrain,
  FaFaceSmile,
  FaFont,
  FaObjectGroup,
  FaSpinner,
  FaTriangleExclamation,
  FaWandMagicSparkles,
} from 'react-icons/fa6'
import { type FaceDetectionSettings, type FaceDetectorKind } from '@photox/shared-types'
import {
  getFaceDetection,
  setFaceDetector,
  reclusterFaces,
  reprocessPipeline,
  getPipelineStatus,
  type ReprocessStatus,
  type FacePipelineRun,
  type FaceReprocessResponse,
  type EmbeddingPipelineRun,
  type EmbeddingReprocessResponse,
  type PipelineRun,
  type PipelineResponse,
} from '../../api/admin'
import {
  AdminCard,
  AdminToast,
  GhostButton,
  PrimaryButton,
  ProgressBar,
  RefreshButton,
  StatStrip,
  StatusPill,
  cx,
} from './ui'
import { ConfirmDialog, InlineError } from './shared'

// --- model card chrome + queue polling --------------------------------------------------

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

/**
 * ponytail: 3s poll while the queue drains; poll errors stay silent and stop after 5 consecutive
 * failures so a broken endpoint is not hammered (re-run/remount resumes).
 */
function useQueuePoll<T extends ReprocessStatus<unknown>>(
  getStatus: () => Promise<T>,
  runToken: number,
): T | null {
  const [status, setStatus] = useState<T | null>(null)
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
  return status
}

/** The reprocess counters both card shapes render from a queue status. */
function useRunProgress<L extends ReprocessRun>(status: ReprocessStatus<L> | null) {
  const lastRun = status?.lastRun ?? null
  const runQueue = status ? status.queue.waiting + status.queue.active : 0
  const running = runQueue > 0
  const requested = lastRun?.enqueued ?? 0
  const done = Math.max(0, Math.min(requested, requested - runQueue))
  const percent = requested > 0 ? Math.round((done / requested) * 100) : 0
  return { lastRun, runQueue, running, requested, done, percent }
}

function RunProgress({
  runningLabel,
  progressLabel,
  runQueue,
  requested,
  done,
  percent,
}: {
  runningLabel: string
  progressLabel: string
  runQueue: number
  requested: number
  done: number
  percent: number
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-on-surface">
          <FaSpinner className="animate-spin text-primary" />
          {runningLabel}
        </span>
        <span className="text-xs tabular-nums text-on-surface-variant">
          {runQueue.toLocaleString()} of {requested.toLocaleString()} remaining · {percent}%
        </span>
      </div>
      <ProgressBar value={done} max={requested} label={progressLabel} />
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

/** The merged detector + reprocess card. */
export function FacialDetectionCard() {
  const [data, setData] = useState<FaceDetectionSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmScrfd, setConfirmScrfd] = useState(false)

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

  const getFaceStatus = useCallback(() => getPipelineStatus<FacePipelineRun>('faces'), [])
  const status = useQueuePoll(getFaceStatus, runToken)

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
      const res = await reprocessPipeline<FaceReprocessResponse>('faces')
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

  const { lastRun, runQueue, running, requested, done, percent } = useRunProgress(status)
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

  const statRows: { label: string; value: ReactNode }[] = [
    { label: 'Detector', value: data ? DETECTOR_LABELS[data.detector] : '—' },
    {
      label: 'Queue',
      value: status ? (running ? runQueue.toLocaleString() : 'Idle') : '—',
    },
  ]

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

      {loading ? (
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
      ) : null}

      {status && !lastRun && !running && (
        <p className="text-xs font-mono text-outline mt-3">No face reprocess runs yet.</p>
      )}

      {running && requested > 0 && (
        <RunProgress
          runningLabel="Reprocessing faces…"
          progressLabel="Face reprocess progress"
          runQueue={runQueue}
          requested={requested}
          done={done}
          percent={percent}
        />
      )}

      {lastRun && !running && (
        <p className="text-xs font-mono text-outline mt-3">
          Last run {new Date(lastRun.startedAt).toLocaleString()} —{' '}
          {lastRun.enqueued.toLocaleString()} of {lastRun.total.toLocaleString()} photos queued with
          the {DETECTOR_LABELS[lastRun.detector]} detector.
        </p>
      )}

      {result && <AdminToast message={result} />}
      {reprocessError && <AdminToast message={reprocessError} tone="error" />}
      {clusterResult && <AdminToast message={clusterResult} />}
      {clusterError && <AdminToast message={clusterError} tone="error" />}

      <div className="mt-auto pt-5">
        <StatStrip rows={statRows} />
        <div className="mt-4 border-t border-border-dark/40 pt-4 flex items-center justify-between gap-3 flex-wrap">
          <RefreshButton
            onClick={() => setVersion((v) => v + 1)}
            label="Refresh face detection settings"
            disabled={saving}
          />
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
        </div>
      </div>

      {confirmScrfd && (
        <ConfirmDialog
          title="Switch to SCRFD anyway?"
          confirmLabel="Switch anyway"
          onClose={() => setConfirmScrfd(false)}
          onConfirm={() => {
            setConfirmScrfd(false)
            void applyDetector('scrfd')
          }}
        >
          <p className="text-sm text-slate-400 mt-2">
            The SCRFD model is not installed, so SCRFD detection jobs will fail until you provision
            it.
          </p>
          <code className="block text-xs font-mono text-slate-300 bg-slate-900/60 border border-border-dark rounded px-2 py-1.5 mt-2 break-all">
            {SCRFD_PROVISION_CMD}
          </code>
        </ConfirmDialog>
      )}

      {confirming && (
        <ConfirmDialog
          title="Reprocess all faces?"
          onClose={() => setConfirming(false)}
          onConfirm={() => void onConfirm()}
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
        </ConfirmDialog>
      )}
    </AdminCard>
  )
}

// --- single-pipeline model cards (embeddings / detections / OCR) ------------------------

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
  getStatus: () => Promise<ReprocessStatus<L>>
  reprocess: () => Promise<{ enqueued: number; total: number }>
  resultText: (res: { enqueued: number; total: number }) => string
  statRows: (status: ReprocessStatus<L> | null) => StatRow[]
}

function queueValue(status: ReprocessStatus<unknown> | null): string {
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
  const [confirming, setConfirming] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runToken, setRunToken] = useState(0)

  const status = useQueuePoll(getStatus, runToken)

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

  const { lastRun, runQueue, running, requested, done, percent } = useRunProgress(status)

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
        <RunProgress
          runningLabel={pipeline.runningLabel}
          progressLabel={pipeline.progressLabel}
          runQueue={runQueue}
          requested={requested}
          done={done}
          percent={percent}
        />
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
        <ConfirmDialog
          title={pipeline.dialogTitle}
          onClose={() => setConfirming(false)}
          onConfirm={() => void onConfirm()}
        >
          <p className="text-sm text-slate-400 mt-2">{pipeline.dialogBody}</p>
        </ConfirmDialog>
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

const EMBEDDINGS_PIPELINE: ReprocessPipeline<EmbeddingPipelineRun> = {
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
  getStatus: () => getPipelineStatus<EmbeddingPipelineRun>('embeddings'),
  reprocess: () => reprocessPipeline<EmbeddingReprocessResponse>('embeddings'),
  resultText: (res) =>
    `Queued ${res.enqueued.toLocaleString()} embedding jobs for ${res.total.toLocaleString()} photos.`,
  statRows: (status) => [
    { label: 'Embedding dim', value: SEARCH_EMBEDDING_DIM },
    { label: 'Last run', value: lastRunValue(status?.lastRun ?? null) },
  ],
}

const DETECTIONS_PIPELINE: ReprocessPipeline<PipelineRun> = {
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
  getStatus: () => getPipelineStatus<PipelineRun>('detections'),
  reprocess: () => reprocessPipeline<PipelineResponse>('detections'),
  resultText: (res) =>
    `Queued ${res.enqueued.toLocaleString()} detection jobs for ${res.total.toLocaleString()} photos.`,
  statRows: (status) => [
    { label: 'Last run', value: lastRunValue(status?.lastRun ?? null) },
    { label: 'Queue', value: queueValue(status) },
  ],
}

const OCR_PIPELINE: ReprocessPipeline<PipelineRun> = {
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
  getStatus: () => getPipelineStatus<PipelineRun>('ocr'),
  reprocess: () => reprocessPipeline<PipelineResponse>('ocr'),
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
