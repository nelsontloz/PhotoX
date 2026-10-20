import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  FaArrowsRotate,
  FaBrain,
  FaFaceSmile,
  FaFont,
  FaObjectGroup,
  FaSpinner,
  FaWandMagicSparkles,
} from 'react-icons/fa6'
import {
  getFaceDetection,
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
  Button,
  ProgressBar,
  StatStrip,
  StatusPill,
  cx,
  type StatRow,
} from './ui'
import { ConfirmDialog, InlineError } from './shared'
import { useAsyncFetch } from '../../hooks/useAsyncFetch'

// --- model card chrome + queue polling --------------------------------------------------

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
function useRunProgress<L extends PipelineRun>(status: ReprocessStatus<L> | null) {
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

/**
 * SCRFD-10G is the only face detector the worker ships, so there is nothing to choose: the card
 * states it as a fixed fact and reports only whether its model file is provisioned on disk.
 */
const FACE_DETECTOR_LABEL = 'SCRFD 10G'

const SCRFD_PROVISION_CMD = 'pnpm --filter @photox/worker-service face-model'
const VISION_PROVISION_CMD = 'pnpm --filter @photox/worker-service vision-model'

/** Amber provisioning note shared by the card banner and its confirm dialog. */
function ModelMissingNote({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <p className="text-xs text-amber-200">{message}</p>
      <code className="block text-xs font-mono text-amber-200/80 mt-1.5 break-all">
        {SCRFD_PROVISION_CMD}
      </code>
    </div>
  )
}

/** The detector + reprocess card: the generic pipeline card with the detector fact + clustering. */
export function FacialDetectionCard() {
  const [version, setVersion] = useState(0)
  const { data, loading, error } = useAsyncFetch(() => getFaceDetection(), {
    refreshKey: version,
    errorMessage: 'Failed to load face detection settings',
    loadingMode: 'always',
  })

  const [clustering, setClustering] = useState(false)
  const [clusterResult, setClusterResult] = useState<string | null>(null)
  const [clusterError, setClusterError] = useState<string | null>(null)

  const getFaceStatus = useCallback(() => getPipelineStatus<FacePipelineRun>('faces'), [])
  const reprocessFaces = useCallback(() => reprocessPipeline<FaceReprocessResponse>('faces'), [])

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

  const modelMissing = data !== undefined && !data.modelAvailable
  const pillTone: 'ok' | 'warn' | 'muted' = error
    ? 'muted'
    : loading
      ? 'muted'
      : modelMissing
        ? 'warn'
        : 'ok'
  const pillLabel = error
    ? 'Unavailable'
    : loading || !data
      ? 'Checking…'
      : modelMissing
        ? 'Model missing'
        : 'Online'

  const pipeline: ReprocessPipeline<FacePipelineRun> = {
    icon: FaFaceSmile,
    title: 'Facial Detection & Clustering',
    prose: `Re-detect and re-embed every photo with ${FACE_DETECTOR_LABEL}. Clustering catches up automatically as jobs finish.`,
    emptyLabel: 'No face reprocess runs yet.',
    runningLabel: 'Reprocessing faces…',
    progressLabel: 'Face reprocess progress',
    buttonLabel: 'Reprocess all faces',
    dialogTitle: 'Reprocess all faces?',
    dialogBody: `This re-detects faces and rebuilds their embeddings for every photo with ${FACE_DETECTOR_LABEL}. People groups rebuild themselves as jobs finish — clustering catches up automatically. The worker runs in the background, so large libraries take a while.`,
    getStatus: getFaceStatus,
    reprocess: reprocessFaces,
    resultText: (res) =>
      `Queued ${res.enqueued.toLocaleString()} face jobs for ${res.total.toLocaleString()} photos.`,
    statRows: (status) => [
      { label: 'Active detector', value: FACE_DETECTOR_LABEL },
      { label: 'Queue', value: queueValue(status) },
    ],
    statusTone: pillTone,
    statusLabel: pillLabel,
    beforeStatus: (
      <>
        {error && <InlineError message={error} onRetry={() => setVersion((v) => v + 1)} />}
        {modelMissing && (
          <ModelMissingNote message="The SCRFD 10G model isn't installed — face detection cannot run until it is provisioned." />
        )}
      </>
    ),
    footerClassName: 'flex items-center justify-between gap-3 flex-wrap',
    footerStart: (
      <Button
        variant="icon"
        onClick={() => setVersion((v) => v + 1)}
        ariaLabel="Refresh face detection settings"
        icon={<FaArrowsRotate />}
      />
    ),
    extraActions: (
      <Button
        variant="ghost"
        onClick={() => void onRecluster()}
        disabled={clustering}
        icon={clustering ? <FaSpinner className="animate-spin" /> : undefined}
      >
        Recluster users
      </Button>
    ),
    extraToasts: (
      <>
        {clusterResult && <AdminToast message={clusterResult} />}
        {clusterError && <AdminToast message={clusterError} tone="error" />}
      </>
    ),
    dialogExtra: modelMissing && (
      <ModelMissingNote message="The SCRFD 10G model isn't installed — these jobs will fail until it is provisioned." />
    ),
  }

  return <ReprocessPipelineCard pipeline={pipeline} />
}

// --- single-pipeline model cards (embeddings / detections / OCR) ------------------------

interface ReprocessPipeline<L extends PipelineRun> {
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
  /** Header pill; defaults to Online once queue status loads. */
  statusTone?: 'ok' | 'warn' | 'muted'
  statusLabel?: string
  /** Extra content between the prose and the empty/last-run lines (error line, model banner). */
  beforeStatus?: ReactNode
  /** Extra toasts after the result/error pair. */
  extraToasts?: ReactNode
  /** Replaces the default right-aligned footer row. */
  footerClassName?: string
  footerStart?: ReactNode
  extraActions?: ReactNode
  /** Extra dialog body under the standard paragraph. */
  dialogExtra?: ReactNode
}

function queueValue(status: ReprocessStatus<unknown> | null): string {
  if (!status) return '—'
  const depth = status.queue.waiting + status.queue.active
  return depth > 0 ? depth.toLocaleString() : 'Idle'
}

function lastRunValue(lastRun: PipelineRun | null): string {
  return lastRun ? new Date(lastRun.startedAt).toLocaleString() : '—'
}

function ReprocessPipelineCard<L extends PipelineRun>({
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

  const confirmButton = (
    <Button
      onClick={() => setConfirming(true)}
      disabled={inFlight || running}
      icon={inFlight ? <FaSpinner className="animate-spin" /> : undefined}
    >
      {inFlight ? 'Enqueuing…' : pipeline.buttonLabel}
    </Button>
  )

  return (
    <AdminCard className="flex flex-col">
      <ModelCardHeader
        icon={pipeline.icon}
        title={pipeline.title}
        chip={pipeline.chip}
        tone={pipeline.statusTone ?? (status ? 'ok' : 'muted')}
        statusLabel={pipeline.statusLabel ?? (status ? 'Online' : 'Checking…')}
      />

      <p className="text-body-sm text-on-surface-variant mt-4">{pipeline.prose}</p>
      {pipeline.note && <p className="text-xs font-mono text-outline mt-2">{pipeline.note}</p>}
      {pipeline.beforeStatus}

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
      {pipeline.extraToasts}

      <div className="mt-auto pt-5">
        <StatStrip rows={pipeline.statRows(status)} />
        <div
          className={cx(
            'mt-4 border-t border-border-dark/40 pt-4',
            pipeline.footerClassName ?? 'flex justify-end',
          )}
        >
          {pipeline.footerStart}
          {pipeline.extraActions ? (
            <div className="flex items-center gap-2 flex-wrap ml-auto">
              {pipeline.extraActions}
              {confirmButton}
            </div>
          ) : (
            confirmButton
          )}
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title={pipeline.dialogTitle}
          onClose={() => setConfirming(false)}
          onConfirm={() => void onConfirm()}
        >
          <p className="text-sm text-slate-400 mt-2">{pipeline.dialogBody}</p>
          {pipeline.dialogExtra}
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
