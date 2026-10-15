import { expect, type APIRequestContext, type Response } from '@playwright/test'
import {
  Given,
  Then,
  When,
  PASSWORD,
  authHeaders,
  injectSession,
  requireAuth,
  seedEmbedding,
  workerHeaders,
  type AuthResponse,
} from '../support'

const ADMIN_EMAIL = 'admin@photox.test'

/** Wire shape of GET /api/v1/admin/faces/reprocess. */
interface FaceStatus {
  lastRun: { startedAt: string; total: number; enqueued: number } | null
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

/** Admin login against the seeded admin (core inserts ADMIN_EMAIL on bootstrap when no
 * admin exists); the register fallback only covers seed-less environments and can never mint
 * admin, so the role assertion still guards the admin flows below. The session is memoized per
 * worker process (under the 30m access TTL) so serial admin scenarios share one login instead
 * of tripping the 5/900s login throttle — production throttle untouched. */
let cachedAdmin: { auth: AuthResponse; at: number } | null = null
const ADMIN_SESSION_REUSE_MS = 20 * 60 * 1000

async function signInAdmin(request: APIRequestContext): Promise<AuthResponse> {
  if (cachedAdmin && Date.now() - cachedAdmin.at < ADMIN_SESSION_REUSE_MS) {
    return cachedAdmin.auth
  }
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
  cachedAdmin = { auth, at: Date.now() }
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
  const response = await request.post(`/worker/assets/${assetId}/faces`, {
    headers: workerHeaders(auth.user.id),
    data: {
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

const isReprocessPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/v1/admin/faces/reprocess'

const isReclusterPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/v1/admin/faces/recluster'

Given('I am signed in as an administrator', async ({ request, page, baseURL, ctx }) => {
  ctx.auth = await signInAdmin(request)
  await injectSession(page, ctx.auth, baseURL)
  await page.goto('/')
})

When('I open the admin dashboard', async ({ page }) => {
  // the reprocess/recluster controls live on the AI Pipelines tab
  await page.goto('/admin?tab=ai')
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
  await page.goto('/admin?tab=ai')
  // the facial card is the only one under the "Facial Detection & Clustering" heading — scope the
  // last-run line to it (the semantic card also renders a "Last run … photos queued." line)
  const card = page
    .locator('div')
    .filter({
      has: page.getByRole('heading', { name: 'Facial Detection & Clustering', exact: true }),
    })
    .filter({ hasText: /Last run .+queued/ })
    .last()
  await expect(card.getByText(/Last run .+queued/)).toBeVisible({ timeout: 20_000 })
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
