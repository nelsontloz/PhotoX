import { expect, type APIRequestContext, type Page, type Response } from '@playwright/test'
import { Given, Then, When, authHeaders, type AuthState, type Ctx, uploadFixture } from './support'

const TEXT_FIXTURE = 'photo-text.jpg'
const SEEDED_OCR_TEXT = 'ZEBRAQUUX77'
const SEEDED_DETECTION_LABEL = 'e2e-seeded-object'

type ReprocessKind = 'embedding' | 'ocr' | 'detection'

interface SemanticUpload {
  name: string
  assetId: string
}

/** Wire shape of GET /api/v1/admin/{embeddings,ocr,detections}/reprocess. */
interface QueueStatus {
  lastRun: { enqueued: number; total: number } | null
  queue: { waiting: number; active: number; completed: number; failed: number; delayed: number }
}

/** Wire shape of GET /api/v1/admin/face-detection, trimmed to the fields these steps need. */
interface FaceSettings {
  detector: 'human' | 'scrfd'
  facesByDetector: { human: number; scrfd: number; unset: number }
}

/** Code-matched subset of GET /api/v1/assets/:id (support's AssetDto has no face fields). */
interface FaceAsset {
  id: string
  faceStatus?: 'pending' | 'ready' | 'failed' | null
  faces?: { id: string }[]
}

interface RelatedAssets {
  items: { id: string }[]
  total: number
}

interface DetectionsResponse {
  detections: { label: string }[]
}

/** ctx has no slots for this state; keep it local instead of editing support.ts. */
type SemanticCtx = Ctx & {
  semanticUploads?: SemanticUpload[]
  faceCountsBefore?: FaceSettings['facesByDetector']
  reprocessRuns?: Partial<Record<ReprocessKind, { enqueued: number; total: number }>>
}

const sctx = (ctx: Ctx): SemanticCtx => ctx

function requireAuth(ctx: Ctx): AuthState {
  if (!ctx.auth) throw new Error('ctx.auth is missing — sign in first')
  return ctx.auth
}

function uploadsOf(ctx: Ctx): SemanticUpload[] {
  const uploads = sctx(ctx).semanticUploads
  if (!uploads || uploads.length === 0) {
    throw new Error('upload a photo for semantic processing first')
  }
  return uploads
}

function uploadByName(ctx: Ctx, name: string): SemanticUpload {
  const upload = uploadsOf(ctx).find((u) => u.name === name)
  if (!upload) throw new Error(`"${name}" was not uploaded for semantic processing`)
  return upload
}

const STATUS_SEGMENT: Record<ReprocessKind, string> = {
  embedding: 'embeddings',
  ocr: 'ocr',
  detection: 'detections',
}

const REPROCESS: Record<
  ReprocessKind,
  { button: string; dialog: string; result: (enqueued: number, total: number) => string }
> = {
  embedding: {
    button: 'Reprocess all embeddings',
    dialog: 'Reprocess all embeddings?',
    result: (enqueued, total) =>
      `Queued ${enqueued.toLocaleString()} embedding jobs for ${total.toLocaleString()} photos.`,
  },
  ocr: {
    button: 'Reprocess OCR text',
    dialog: 'Reprocess OCR text?',
    result: (enqueued, total) =>
      `Queued ${enqueued.toLocaleString()} OCR jobs for ${total.toLocaleString()} photos.`,
  },
  detection: {
    button: 'Reprocess object detection',
    dialog: 'Reprocess object detection?',
    result: (enqueued, total) =>
      `Queued ${enqueued.toLocaleString()} detection jobs for ${total.toLocaleString()} photos.`,
  },
}

const statusPath = (kind: ReprocessKind): string =>
  `/api/v1/admin/${STATUS_SEGMENT[kind]}/reprocess`

async function fetchFaceSettings(
  request: APIRequestContext,
  auth: AuthState,
): Promise<FaceSettings> {
  const response = await request.get('/api/v1/admin/face-detection', { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as FaceSettings
}

async function fetchReprocessStatus(
  request: APIRequestContext,
  auth: AuthState,
  kind: ReprocessKind,
): Promise<QueueStatus> {
  const response = await request.get(statusPath(kind), { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as QueueStatus
}

async function fetchSimilar(
  request: APIRequestContext,
  auth: AuthState,
  assetId: string,
): Promise<RelatedAssets> {
  const response = await request.get(`/api/v1/assets/${assetId}/similar`, {
    headers: authHeaders(auth),
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as RelatedAssets
}

async function fetchDetections(
  request: APIRequestContext,
  auth: AuthState,
  assetId: string,
): Promise<DetectionsResponse> {
  const response = await request.get(`/api/v1/assets/${assetId}/detections`, {
    headers: authHeaders(auth),
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as DetectionsResponse
}

/** `similar` is empty exactly when the source asset has no embedding — B proving A embedded. */
async function expectVisuallySimilar(
  request: APIRequestContext,
  auth: AuthState,
  a: string,
  b: string,
): Promise<void> {
  await expect
    .poll(async () => (await fetchSimilar(request, auth, a)).items.some((item) => item.id === b), {
      timeout: 120_000,
      message: 'the uploaded photos never became visually similar — embedding missing or failed',
    })
    .toBe(true)
}

async function startReprocess(page: Page, ctx: Ctx, kind: ReprocessKind): Promise<void> {
  const { button, dialog, result } = REPROCESS[kind]
  await page.getByRole('button', { name: button }).click()
  await expect(page.getByRole('heading', { level: 3, name: dialog })).toBeVisible()
  const isReprocessPost = (response: Response): boolean =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === statusPath(kind)
  const [response] = await Promise.all([
    page.waitForResponse(isReprocessPost),
    page.getByRole('button', { name: 'Confirm' }).click(),
  ])
  expect(response.status()).toBe(200)
  const run = (await response.json()) as { enqueued: number; total: number }
  // every non-trashed photo gets exactly one job — a partial enqueue is a bug
  expect(run.total).toBeGreaterThanOrEqual(1)
  expect(run.enqueued).toBe(run.total)
  sctx(ctx).reprocessRuns = { ...sctx(ctx).reprocessRuns, [kind]: run }
  await expect(page.getByText(result(run.enqueued, run.total), { exact: true })).toBeVisible()
}

async function drainReprocess(
  request: APIRequestContext,
  ctx: Ctx,
  kind: ReprocessKind,
): Promise<void> {
  const run = sctx(ctx).reprocessRuns?.[kind]
  if (!run) throw new Error(`start an ${kind} reprocess run first`)
  const auth = requireAuth(ctx)
  await expect
    .poll(
      async () => {
        const status = await fetchReprocessStatus(request, auth, kind)
        return status.queue.waiting + status.queue.active
      },
      { timeout: 120_000, message: `the ${kind} reprocess queue never drained` },
    )
    .toBe(0)
  const lastRun = (await fetchReprocessStatus(request, auth, kind)).lastRun
  if (!lastRun) throw new Error(`the ${kind} reprocess run was not recorded`)
  expect(lastRun.enqueued).toBe(run.enqueued)
  expect(lastRun.total).toBe(run.total)
}

When(
  'I upload {string} for semantic processing',
  async ({ page, ctx, $testInfo }, name: string) => {
    // scenario 4 runs three global reprocess queues; give it room beyond the 120s default
    $testInfo.setTimeout(240_000)
    // 06 uploads photo.jpg as the admin first, so scenario 4 legitimately gets a 409 pointing at
    // the already-processed asset — the duplicate is fine, only the asset id matters here
    const assetId = await uploadFixture(page, name, { allowDuplicate: true })
    const uploads = (sctx(ctx).semanticUploads ??= [])
    uploads.push({ name, assetId })
    ctx.assetId = assetId
  },
)

Then('the uploaded photos are visually similar to each other', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const uploads = uploadsOf(ctx)
  const [a, b] = uploads
  if (!a || !b) throw new Error('upload two photos for semantic processing first')
  await expectVisuallySimilar(request, auth, a.assetId, b.assetId)
})

Given('I remember the faces-by-detector counts', async ({ request, ctx }) => {
  const settings = await fetchFaceSettings(request, requireAuth(ctx))
  sctx(ctx).faceCountsBefore = settings.facesByDetector
})

Then(
  'face detection on the uploaded photo settles with a detected face',
  async ({ request, ctx }) => {
    const auth = requireAuth(ctx)
    const assetId = ctx.assetId
    if (!assetId) throw new Error('upload a photo first')
    await expect
      .poll(
        async () => {
          const response = await request.get(`/api/v1/assets/${assetId}`, {
            headers: authHeaders(auth),
          })
          expect(response.status()).toBe(200)
          const asset = (await response.json()) as FaceAsset
          if (asset.faceStatus === 'failed') {
            throw new Error(`face detection failed on asset ${assetId}`)
          }
          return asset.faceStatus === 'ready' && (asset.faces ?? []).length >= 1
        },
        {
          timeout: 120_000,
          message: 'face detection never reported a face on the portrait fixture',
        },
      )
      .toBe(true)
  },
)

Then('the new faces are counted under the active detector', async ({ request, ctx }) => {
  const before = sctx(ctx).faceCountsBefore
  if (!before) throw new Error('remember the faces-by-detector counts first')
  const settings = await fetchFaceSettings(request, requireAuth(ctx))
  expect(settings.facesByDetector[settings.detector]).toBeGreaterThan(before[settings.detector])
})

Given('the initial semantic processing has settled', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const uploads = uploadsOf(ctx)
  const [a, b] = uploads
  if (!a || !b) throw new Error('upload two photos for semantic processing first')
  // queue drain proves the upload-path jobs finished; the similarity probe proves the embeddings
  // landed (OCR/detection rows have no read path in e2e — see feature notes in the summary)
  for (const kind of ['embedding', 'ocr', 'detection'] as const) {
    await expect
      .poll(
        async () => {
          const status = await fetchReprocessStatus(request, auth, kind)
          return status.queue.waiting + status.queue.active
        },
        { timeout: 120_000, message: `the ${kind} queue never drained after upload` },
      )
      .toBe(0)
  }
  await expectVisuallySimilar(request, auth, a.assetId, b.assetId)
})

Given('I seed a detection on the uploaded text photo', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const { assetId } = uploadByName(ctx, TEXT_FIXTURE)
  const response = await request.post(`/api/v1/assets/${assetId}/detections`, {
    headers: authHeaders(auth),
    data: {
      detections: [
        {
          label: SEEDED_DETECTION_LABEL,
          confidence: 0.9,
          box: { x: 1, y: 1, w: 10, h: 10 },
        },
      ],
    },
  })
  expect(response.status()).toBe(201)
  const list = await fetchDetections(request, auth, assetId)
  expect(list.detections.map((detection) => detection.label)).toContain(SEEDED_DETECTION_LABEL)
})

Given('I seed OCR text on the uploaded text photo', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const { assetId } = uploadByName(ctx, TEXT_FIXTURE)
  const response = await request.post(`/api/v1/assets/${assetId}/ocr`, {
    headers: authHeaders(auth),
    data: { text: SEEDED_OCR_TEXT, lang: 'eng', confidence: 0.9 },
  })
  expect(response.status()).toBe(201)
  // no GET :id/ocr route exists, and /search can't run in the e2e core image (node:22-alpine lacks
  // the glibc loader onnxruntime-node needs), so OCR replacement is not observable — the seed only
  // gives the reprocess a row to replace
})

When('I start an embedding reprocess run', async ({ page, ctx }) => {
  await startReprocess(page, ctx, 'embedding')
})

When('I start an OCR reprocess run', async ({ page, ctx }) => {
  await startReprocess(page, ctx, 'ocr')
})

When('I start a detection reprocess run', async ({ page, ctx }) => {
  await startReprocess(page, ctx, 'detection')
})

Then('the embedding reprocess queue drains', async ({ request, ctx }) => {
  await drainReprocess(request, ctx, 'embedding')
})

Then('the OCR reprocess queue drains', async ({ request, ctx }) => {
  await drainReprocess(request, ctx, 'ocr')
})

Then('the detection reprocess queue drains', async ({ request, ctx }) => {
  await drainReprocess(request, ctx, 'detection')
})

Then('the seeded detection is replaced without duplicates', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const { assetId } = uploadByName(ctx, TEXT_FIXTURE)
  await expect
    .poll(
      async () => {
        const list = await fetchDetections(request, auth, assetId)
        return list.detections.some((detection) => detection.label === SEEDED_DETECTION_LABEL)
      },
      { timeout: 30_000, message: 'the seeded detection survived the detection reprocess' },
    )
    .toBe(false)
  const labels = (await fetchDetections(request, auth, assetId)).detections.map((d) => d.label)
  expect(new Set(labels).size).toBe(labels.length)
})

Then('the admin page shows the last embedding reprocess run', async ({ page }) => {
  await page.goto('/admin')
  // three pipeline cards share the "Last run … photos queued." line — scope to the one whose
  // heading is "Semantic Search" (innermost div containing both heading and the last-run text)
  const card = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Semantic Search', exact: true }) })
    .filter({ hasText: /photos queued\./ })
    .last()
  await expect(card.getByText(/Last run .+ photos queued\./)).toBeVisible({ timeout: 20_000 })
})
