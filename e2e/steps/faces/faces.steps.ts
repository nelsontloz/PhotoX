import { expect, type APIRequestContext, type Page, type Response } from '@playwright/test'
import {
  Given,
  Then,
  When,
  PASSWORD,
  authHeaders,
  fetchFaceSettings,
  injectSession,
  requireAuth,
  seedEmbedding,
  type AuthResponse,
  type Ctx,
  type FaceDetectionSettings,
  type FaceDetectorKind,
} from '../support'

const ADMIN_EMAIL = 'admin@photox.test'

/** Wire shape of GET /api/v1/admin/faces/reprocess. */
interface FaceStatus {
  lastRun: { startedAt: string; total: number; enqueued: number; detector: FaceDetectorKind } | null
  queue: {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
  }
}

/** Code-matched subset of GET /api/v1/assets/:id. */
interface FaceAsset {
  id: string
  faceStatus?: 'pending' | 'ready' | 'failed' | null
  faces?: { id: string }[]
}

/** Wire shape of GET /api/v1/persons, trimmed to the fields the cluster assertion needs. */
interface PersonList {
  items: { id: string; faceCount: number }[]
}

/** Admin login, falling back to register (the first account of an empty instance becomes admin). */
async function signInAdmin(request: APIRequestContext): Promise<AuthResponse> {
  let response = await request.post('/api/v1/auth/login', {
    data: { email: ADMIN_EMAIL, password: PASSWORD },
  })
  if (!response.ok()) {
    response = await request.post('/api/v1/auth/register', {
      data: { email: ADMIN_EMAIL, password: PASSWORD, displayName: 'E2E Admin' },
    })
  }
  expect(response.ok()).toBe(true)
  const auth = (await response.json()) as AuthResponse
  if (auth.user.role !== 'admin') {
    throw new Error(`expected ${ADMIN_EMAIL} to have the admin role, got "${auth.user.role}"`)
  }
  return auth
}

interface SeedFace {
  box: { x: number; y: number; w: number; h: number }
}

/**
 * Appends faces via the authenticated user endpoint. The worker's face job DELETEs + re-detects,
 * so a seeded face is the probe that proves the job actually executed.
 */
async function seedFaces(
  request: APIRequestContext,
  auth: AuthResponse,
  assetId: string,
  faces: SeedFace[],
): Promise<void> {
  const response = await request.post(`/api/v1/assets/${assetId}/faces`, {
    headers: authHeaders(auth),
    data: {
      detector: 'human',
      faces: faces.map((face) => ({ ...face, confidence: 0.9, embedding: seedEmbedding() })),
    },
  })
  expect(response.status()).toBe(201)
  expect(((await response.json()) as { count: number }).count).toBe(faces.length)
}

async function fetchFaceAsset(
  request: APIRequestContext,
  auth: AuthResponse,
  assetId: string,
): Promise<FaceAsset> {
  const response = await request.get(`/api/v1/assets/${assetId}`, { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as FaceAsset
}

const isDetectorPut = (response: Response): boolean =>
  response.request().method() === 'PUT' &&
  new URL(response.url()).pathname === '/api/v1/admin/face-detection'

const isReprocessPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/v1/admin/faces/reprocess'

const isReclusterPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/v1/admin/faces/recluster'

function parseDetector(value: string): FaceDetectorKind {
  if (value !== 'human' && value !== 'scrfd') throw new Error(`unknown face detector: ${value}`)
  return value
}

const detectorRadio = (page: Page, detector: FaceDetectorKind) =>
  page.locator(`input[name="face-detector"][value="${detector}"]`)

/** Applies `target`; a disabled SCRFD radio routes through the amber fallback confirm dialog. */
async function switchDetector(
  page: Page,
  request: APIRequestContext,
  ctx: Ctx,
  target: FaceDetectorKind,
): Promise<void> {
  const active = (await fetchFaceSettings(request, requireAuth(ctx))).detector
  if (active === target) {
    // silently returning would let the scenario pass without ever exercising the PUT
    throw new Error(`the active face detector is already "${target}" — nothing would be switched`)
  }

  const radio = detectorRadio(page, target)
  const apply = async (click: () => Promise<void>): Promise<void> => {
    const [response] = await Promise.all([page.waitForResponse(isDetectorPut), click()])
    expect(response.status()).toBe(200)
    const body = (await response.json()) as FaceDetectionSettings
    expect(body.detector).toBe(target)
  }

  if (await radio.isDisabled()) {
    await page.getByRole('button', { name: 'Switch to SCRFD anyway' }).click()
    await expect(
      page.getByRole('heading', { level: 3, name: 'Switch to SCRFD anyway?' }),
    ).toBeVisible()
    await apply(() => page.getByRole('button', { name: 'Switch anyway' }).click())
  } else {
    await apply(() => radio.click())
  }
  await expect(radio).toBeChecked()
}

async function expectActiveDetector(
  page: Page,
  request: APIRequestContext,
  ctx: Ctx,
  expected: FaceDetectorKind,
): Promise<void> {
  expect((await fetchFaceSettings(request, requireAuth(ctx))).detector).toBe(expected)
  await expect(detectorRadio(page, expected)).toBeChecked()
}

Given('I am signed in as an administrator', async ({ request, page, ctx }) => {
  ctx.auth = await signInAdmin(request)
  await injectSession(page, ctx.auth)
  await page.goto('/')
})

When('I open the admin dashboard', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { level: 1, name: 'Admin Console' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByRole('heading', { level: 2, name: 'Machine Learning Models & Inference' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 3, name: 'Facial Detection & Clustering' }),
  ).toBeVisible()
})

When('I remember the active face detector', async ({ request, page, ctx }) => {
  const settings = await fetchFaceSettings(request, requireAuth(ctx))
  ctx.faceDetectorOriginal = settings.detector
  await expect(detectorRadio(page, settings.detector)).toBeChecked()
})

When('I switch the face detector to {string}', async ({ page, request, ctx }, target: string) => {
  await switchDetector(page, request, ctx, parseDetector(target))
})

When(
  'I switch the face detector back to the remembered detector',
  async ({ page, request, ctx }) => {
    const original = ctx.faceDetectorOriginal
    if (!original) throw new Error('remember the active face detector first')
    await switchDetector(page, request, ctx, original)
  },
)

Then('the active face detector is {string}', async ({ page, request, ctx }, expected: string) => {
  await expectActiveDetector(page, request, ctx, parseDetector(expected))
})

Then('the active face detector is the remembered detector', async ({ page, request, ctx }) => {
  const original = ctx.faceDetectorOriginal
  if (!original) throw new Error('remember the active face detector first')
  await expectActiveDetector(page, request, ctx, original)
})

Given('the initial face detection has settled', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const assetId = ctx.assetId
  if (!assetId) throw new Error('upload a photo first')
  await expect
    .poll(
      async () => {
        const asset = await fetchFaceAsset(request, auth, assetId)
        if (asset.faceStatus === 'failed') {
          throw new Error(`face detection failed on asset ${assetId}`)
        }
        return asset.faceStatus
      },
      { timeout: 60_000 },
    )
    .toBe('ready')
})

Given('I seed a face on that photo', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const assetId = ctx.assetId
  if (!assetId) throw new Error('upload a photo first')
  await seedFaces(request, auth, assetId, [{ box: { x: 10, y: 10, w: 60, h: 60 } }])
  const asset = await fetchFaceAsset(request, auth, assetId)
  expect((asset.faces ?? []).length).toBe(1)
})

Then('the seeded face is gone after the reprocess', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const assetId = ctx.assetId
  if (!assetId) throw new Error('upload a photo first')
  await expect
    .poll(
      async () => {
        const asset = await fetchFaceAsset(request, auth, assetId)
        if (asset.faceStatus === 'failed') {
          throw new Error(`face reprocess failed on asset ${assetId}`)
        }
        return asset.faceStatus === 'ready' && (asset.faces ?? []).length === 0
      },
      { timeout: 120_000 },
    )
    .toBe(true)
})

When('I start a face reprocess run', async ({ page, request, ctx }) => {
  await page.getByRole('button', { name: 'Reprocess all faces' }).click()
  await expect(page.getByRole('heading', { level: 3, name: 'Reprocess all faces?' })).toBeVisible()
  const [response] = await Promise.all([
    page.waitForResponse(isReprocessPost),
    page.getByRole('button', { name: 'Confirm' }).click(),
  ])
  expect(response.status()).toBe(200)
  const run = (await response.json()) as { enqueued: number; total: number }
  ctx.faceReprocess = run
  // `enqueued` counts requested jobs; check Redis once so a run that enqueued nothing is caught.
  // Tiny race accepted (the job may drain first) — the seeded-face check below is the durable proof.
  const statusResponse = await request.get('/api/v1/admin/faces/reprocess', {
    headers: authHeaders(requireAuth(ctx)),
  })
  expect(statusResponse.status()).toBe(200)
  const status = (await statusResponse.json()) as FaceStatus
  expect(status.queue.waiting + status.queue.active).toBeGreaterThanOrEqual(1)
  await expect(
    page.getByText(
      `Queued ${run.enqueued.toLocaleString()} face jobs for ${run.total.toLocaleString()} photos.`,
      { exact: true },
    ),
  ).toBeVisible()
})

Then('the face reprocess reports queued jobs for every photo', ({ ctx }) => {
  const run = ctx.faceReprocess
  if (!run) throw new Error('start a face reprocess run first')
  expect(run.total).toBeGreaterThanOrEqual(1)
  expect(run.enqueued).toBe(run.total)
})

Then('the face reprocess queue drains', async ({ request, ctx }) => {
  const run = ctx.faceReprocess
  if (!run) throw new Error('start a face reprocess run first')
  const auth = requireAuth(ctx)
  const fetchStatus = async (): Promise<FaceStatus> => {
    const response = await request.get('/api/v1/admin/faces/reprocess', {
      headers: authHeaders(auth),
    })
    expect(response.status()).toBe(200)
    const status = (await response.json()) as FaceStatus
    if (typeof status.queue.waiting !== 'number' || typeof status.queue.active !== 'number') {
      throw new Error('face reprocess status is missing queue counts')
    }
    return status
  }
  await expect
    .poll(
      async () => {
        const status = await fetchStatus()
        return status.queue.waiting + status.queue.active
      },
      { timeout: 120_000 },
    )
    .toBe(0)
  const lastRun = (await fetchStatus()).lastRun
  if (!lastRun) throw new Error('the reprocess run was not recorded')
  expect(lastRun.enqueued).toBe(run.enqueued)
  expect(lastRun.total).toBe(run.total)
})

Then('the admin page shows the last face reprocess run', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByText(/Last run .+ queued with the .+ detector\./)).toBeVisible({
    timeout: 20_000,
  })
})

Given('I seed two matching faces on my latest photo', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const response = await request.get('/api/v1/assets?limit=1', { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  const list = (await response.json()) as { items?: { id: string }[] }
  const assetId = list.items?.[0]?.id
  if (!assetId) throw new Error('no asset found — upload one first')
  // identical embeddings -> one DBSCAN cluster -> one person with two faces
  await seedFaces(request, auth, assetId, [
    { box: { x: 10, y: 10, w: 60, h: 60 } },
    { box: { x: 80, y: 10, w: 60, h: 60 } },
  ])
  const asset = await fetchFaceAsset(request, auth, assetId)
  expect((asset.faces ?? []).length).toBeGreaterThanOrEqual(2)
})

When('I recluster face users', async ({ page, ctx }) => {
  const [response] = await Promise.all([
    page.waitForResponse(isReclusterPost),
    page.getByRole('button', { name: 'Recluster users' }).click(),
  ])
  expect(response.status()).toBe(200)
  ctx.reclusterEnqueued = ((await response.json()) as { enqueued: number }).enqueued
})

Then('the seeded faces are grouped into a person', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const fetchPersons = async (): Promise<PersonList> => {
    const response = await request.get('/api/v1/persons', { headers: authHeaders(auth) })
    expect(response.status()).toBe(200)
    return (await response.json()) as PersonList
  }
  try {
    await expect
      .poll(async () => (await fetchPersons()).items.some((p) => p.faceCount >= 2), {
        timeout: 120_000,
      })
      .toBe(true)
  } catch {
    const counts = (await fetchPersons()).items.map((p) => p.faceCount)
    throw new Error(
      `the cluster job never grouped the seeded faces into a person (faceCounts: [${counts.join(', ')}])`,
    )
  }
})

Then('the admin page confirms the recluster outcome', async ({ page, ctx }) => {
  const enqueued = ctx.reclusterEnqueued
  if (enqueued === undefined) throw new Error('recluster face users first')
  const expected =
    enqueued > 0
      ? `Clustering queued for ${enqueued.toLocaleString()} ${enqueued === 1 ? 'user' : 'users'}.`
      : 'Nothing to cluster — no faces yet.'
  await expect(page.getByText(expected, { exact: true })).toBeVisible()
})
