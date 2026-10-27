import { createHmac, randomUUID } from 'node:crypto'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test'
import { createBdd, test as base } from 'playwright-bdd'
import { FACE_EMBEDDING_DIM, type Asset, type AuthResponse } from '@photox/shared-types'

export const PASSWORD = 'password123'
/** Copy the register page shows in place of the form when public sign-ups are closed. */
export const SIGNUPS_CLOSED_NOTICE =
  'Public sign-ups are disabled. Ask an administrator for an account.'
// apps/web is "type": "module" — steps load as ESM, so no __dirname
export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url))

// re-exported for step files so they keep importing wire types from support, not shared-types
export type { AuthResponse }

/** Album id + name as returned by the album API. */
export interface AlbumRef {
  id: string
  name: string
}

/** Trimmed favorites list response cached by the favorites steps. */
export interface FavoriteAsset {
  id: string
  favorite: boolean
}

export interface FavoriteList {
  items: FavoriteAsset[]
  total: number
}

/** A fixture tracked by the semantic steps. */
export interface SemanticUpload {
  name: string
  assetId: string
}

export type ReprocessKind = 'embedding' | 'detection'

export interface ReprocessRun {
  enqueued: number
  total: number
}

/** Trimmed share response cached by the sharing steps (asset + album fields, loose shape). */
export interface ShareState {
  id: string
  kind: 'asset' | 'album'
  token: string
  assetId?: string
  albumId?: string
  albumName?: string
}

/** Scenario state; each slot is optional and only the owning feature's steps fill it. */
export interface Ctx {
  auth?: AuthResponse
  assetId?: string
  lastStatus?: number
  // albums
  albums?: AlbumRef[]
  albumAssets?: string[]
  albumPage?: AlbumRef[]
  // isolation users shared by albums/favorites/sharing
  otherAuth?: AuthResponse
  otherAssetId?: string
  // faces
  faceReprocess?: ReprocessRun
  reclusterEnqueued?: number
  // favorites
  favoriteIds?: string[]
  listResponses?: FavoriteList[]
  otherListResponse?: FavoriteList
  // people
  personId?: string
  personFaceId?: string
  otherUser?: AuthResponse
  // places
  placesAssetIds?: string[]
  placesCenter?: { lat: number; lng: number }
  placesView?: { lat: number; lng: number; z: number }
  placesWalkedIds?: string[]
  // semantic
  semanticUploads?: SemanticUpload[]
  reprocessRuns?: Partial<Record<ReprocessKind, ReprocessRun>>
  // sharing
  assetShare?: ShareState
  assetShareAgain?: ShareState
  albumShare?: ShareState
  videoShare?: ShareState
  lastShare?: ShareState
  shareOwner?: AuthResponse
  albumId?: string
  albumName?: string
  albumMemberId?: string
  otherShare?: ShareState
  streamContentRange?: string | null
  // trash
  trashAssetIds?: string[]
  openTrashedId?: string
}

// playwright-bdd requires the custom test to extend ITS test (BDD fixtures), and the exported
// `test` is what bddgen imports into the generated specs.
export const test = base.extend<{ ctx: Ctx }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern even with no fixture deps
  ctx: async ({}, use) => {
    await use({})
  },
})

export const { Given, When, Then, AfterStep, After } = createBdd(test)

// One screenshot per Gherkin step, nested under that step in the HTML report.
// AfterStep runs inside the step's test.step() — even when the step throws — so failures get a frame.
AfterStep(async ({ page, $testInfo }) => {
  await $testInfo.attach('screenshot', { body: await page.screenshot(), contentType: 'image/png' })
})

/** Registers a user through the API; unique email unless one is given. */
export async function registerUser(
  request: APIRequestContext,
  email?: string,
): Promise<AuthResponse> {
  const response = await request.post('/api/v1/auth/register', {
    data: {
      email: email ?? `e2e-${randomUUID()}@photox.test`,
      password: PASSWORD,
      displayName: 'E2E User',
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as AuthResponse
}

/** Signs in through the API and returns the session; asserts the login succeeded. */
export async function signIn(
  request: APIRequestContext,
  email: string,
  password: string = PASSWORD,
): Promise<AuthResponse> {
  const response = await request.post('/api/v1/auth/login', { data: { email, password } })
  expect(response.ok(), `login for ${email} failed with status ${response.status()}`).toBe(true)
  return (await response.json()) as AuthResponse
}

/** Seeds the zustand-persisted session and the access cookie before the app loads. */
export async function injectSession(
  page: Page,
  auth: AuthResponse,
  baseURL: string | undefined,
): Promise<void> {
  if (!baseURL) throw new Error('baseURL is required to seed the access cookie')
  const persisted = JSON.stringify({
    state: {
      user: auth.user,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    },
    version: 0,
  })
  await page.addInitScript((value: string) => {
    // seed only when nothing is persisted: a full page reload after sign-out must stay signed out
    // (a dev-server reload would otherwise resurrect the session this script re-writes on load)
    if (!window.localStorage.getItem('photox.auth')) {
      window.localStorage.setItem('photox.auth', value)
    }
  }, persisted)
  // browser subresources (<img>/<video> hitting /api/v1/files/:id/stream) authenticate via the
  // HttpOnly cookie, not localStorage — seed the same token for the web origin, scoped to /api
  await page.context().addCookies([
    {
      name: 'photox_access',
      value: auth.accessToken,
      // url form keeps it host-only with path /api, so the server's logout clear matches it
      url: `${baseURL}/api`,
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    },
  ])
}

export async function readSessionRole(page: Page): Promise<string> {
  const raw = await page.evaluate(() => window.localStorage.getItem('photox.auth'))
  if (!raw) throw new Error('photox.auth is missing from localStorage')
  const parsed = JSON.parse(raw) as { state?: { user?: { role?: string } } }
  const role = parsed.state?.user?.role
  if (!role) throw new Error('photox.auth holds no user role')
  return role
}

export function authHeaders(auth: AuthResponse): Record<string, string> {
  return { Authorization: `Bearer ${auth.accessToken}` }
}

const ADMIN_EMAIL = 'admin@photox.test'

// Admin login against the seeded admin, sharing one session across the parallel `suite`
// workers through the same tmp file as the backups steps (same path, same `{ auth, at }`
// shape, same lock): exactly one leader spends a single login instead of tripping the
// 5/900s per-email login throttle, followers adopt its session.
let cachedAdmin: { auth: AuthResponse; at: number } | null = null
const ADMIN_SESSION_REUSE_MS = 20 * 60 * 1000
// run.sh exports a unique E2E_WEB_PORT per run, isolating parallel runs sharing this tmpdir
const ADMIN_SESSION_FILE = join(
  tmpdir(),
  `photox-e2e-admin-session-${process.env.E2E_WEB_PORT ?? 'default'}.json`,
)
const ADMIN_SESSION_LOCK = `${ADMIN_SESSION_FILE}.lock`

async function readSharedAdmin(): Promise<AuthResponse | null> {
  try {
    const parsed = JSON.parse(await readFile(ADMIN_SESSION_FILE, 'utf8')) as {
      auth?: AuthResponse
      at?: number
    }
    if (
      parsed.auth?.accessToken &&
      parsed.auth.user?.role === 'admin' &&
      typeof parsed.at === 'number' &&
      Date.now() - parsed.at < ADMIN_SESSION_REUSE_MS
    ) {
      return parsed.auth
    }
  } catch {
    // cold start or a half-written file from a racing worker — fall through to the login path
  }
  return null
}

async function waitForSharedAdmin(timeoutMs: number): Promise<AuthResponse | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const auth = await readSharedAdmin()
    if (auth) return auth
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function writeSharedAdmin(auth: AuthResponse): Promise<void> {
  try {
    await writeFile(ADMIN_SESSION_FILE, JSON.stringify({ auth, at: Date.now() }), 'utf8')
  } catch {
    // best-effort cross-worker hint; the in-memory cache still covers this worker
  }
}

/** Signs in as the seeded admin, reusing the session shared across the parallel suite workers. */
export async function signInAdmin(request: APIRequestContext): Promise<AuthResponse> {
  if (cachedAdmin && Date.now() - cachedAdmin.at < ADMIN_SESSION_REUSE_MS) {
    return cachedAdmin.auth
  }
  const shared = await readSharedAdmin()
  if (shared) {
    cachedAdmin = { auth: shared, at: Date.now() }
    return shared
  }
  // leader election so the cold-start herd spends exactly one login, not one per worker
  let leader: boolean
  try {
    try {
      const stale = await stat(ADMIN_SESSION_LOCK)
      if (Date.now() - stale.mtimeMs > 60_000) await unlink(ADMIN_SESSION_LOCK)
    } catch {
      // no lock file — nothing stale to break
    }
    await writeFile(ADMIN_SESSION_LOCK, String(process.pid), { flag: 'wx' })
    leader = true
  } catch {
    leader = false
  }
  if (!leader) {
    const adopted = await waitForSharedAdmin(60_000)
    if (adopted) {
      cachedAdmin = { auth: adopted, at: Date.now() }
      return adopted
    }
    // the leader died without writing — fall through and try the login ourselves
  }
  try {
    let response = await request.post('/api/v1/auth/login', {
      data: { email: ADMIN_EMAIL, password: PASSWORD },
    })
    if (!response.ok()) {
      response = await request.post('/api/v1/auth/register', {
        data: { email: ADMIN_EMAIL, password: PASSWORD, displayName: 'E2E Admin' },
      })
    }
    expect(response.ok(), `admin auth failed with status ${response.status()}`).toBe(true)
    const auth = (await response.json()) as AuthResponse
    if (auth.user.role !== 'admin') {
      throw new Error(`expected ${ADMIN_EMAIL} to have the admin role, got "${auth.user.role}"`)
    }
    cachedAdmin = { auth, at: Date.now() }
    await writeSharedAdmin(auth)
    return auth
  } finally {
    if (leader) await unlink(ADMIN_SESSION_LOCK).catch(() => undefined)
  }
}

// e2e seeding hits the act-required worker routes (#156 moved extraction writes there), so the
// suite mints its own delegated tokens with node:crypto (no new deps). Same HS256 shape as the
// worker's CoreClient; the secret mirrors docker-compose.e2e.yml (override with
// E2E_AUTH_TOKEN_SECRET when it diverges).
const E2E_AUTH_TOKEN_SECRET =
  process.env.E2E_AUTH_TOKEN_SECRET ?? 'dev-auth-secret-32-characters-minimum!!'

function base64url(input: string | Buffer): string {
  return (typeof input === 'string' ? Buffer.from(input) : input).toString('base64url')
}

/** Delegated worker headers scoped to a job user id (test seeding only, never prod). */
export function workerHeaders(userId: string): Record<string, string> {
  // the guard mandates iat on every verified token and fails closed when absent
  const now = Math.floor(Date.now() / 1000)
  const encoded =
    `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.` +
    `${base64url(JSON.stringify({ sub: userId, email: 'worker@internal', role: 'user', act: { sub: 'worker-service' }, iat: now, exp: now + 1800 }))}`
  const signature = base64url(createHmac('sha256', E2E_AUTH_TOKEN_SECRET).update(encoded).digest())
  return { Authorization: `Bearer ${encoded}.${signature}` }
}

/** The signed-in user for this scenario; every authenticated step starts here. */
export function requireAuth(ctx: Ctx): AuthResponse {
  if (!ctx.auth) throw new Error('ctx.auth is missing — sign in first')
  return ctx.auth
}

/** The second user a scenario registered for isolation checks. */
export function requireOtherAuth(ctx: Ctx): AuthResponse {
  if (!ctx.otherAuth) throw new Error('register the other user first')
  return ctx.otherAuth
}

export function requireAssetId(ctx: Ctx): string {
  if (!ctx.assetId) throw new Error('ctx.assetId is missing — upload an asset first')
  return ctx.assetId
}

/** Deterministic unit vector along `axis` — fixtures have no real faces, so seeds are synthetic. */
export function seedEmbedding(axis = 0): number[] {
  return Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => (i === axis ? 1 : 0))
}

/** Creates an album via the API and returns it as an AlbumRef. */
export async function createAlbumViaApi(
  request: APIRequestContext,
  auth: AuthResponse,
  name: string,
): Promise<AlbumRef> {
  const response = await request.post('/api/v1/albums', {
    headers: authHeaders(auth),
    data: { name },
  })
  expect(response.status()).toBe(201)
  const album = (await response.json()) as AlbumRef
  if (!album.id) throw new Error('album response did not include an id')
  return { id: album.id, name: album.name }
}

/** Adds assets to an album via the API; returns the status so callers assert the outcome. */
export async function addAssetsViaApi(
  request: APIRequestContext,
  auth: AuthResponse,
  albumId: string,
  assetIds: string[],
): Promise<number> {
  const response = await request.post(`/api/v1/albums/${albumId}/assets`, {
    headers: authHeaders(auth),
    data: { assetIds },
  })
  return response.status()
}

/** Hit-row subset of POST /api/v1/files/exists (exists=false rows carry no ids). */
interface ExistsHit {
  checksumSha256: string
  exists: boolean
  existingFileId?: string
  existingAssetId?: string
}

async function extractFilesPostAssetId(
  response: Response,
  options: { allowDuplicate?: boolean },
): Promise<string> {
  if (options.allowDuplicate && response.status() === 409) {
    // the same user already uploaded this fixture earlier in the run; core points back at the
    // existing asset, which the upload path already embedded/processed
    const body = (await response.json()) as { existingAssetId?: string }
    if (!body.existingAssetId) {
      throw new Error('duplicate upload response did not include the existing asset id')
    }
    return body.existingAssetId
  }
  expect(response.status()).toBe(201)
  const asset = (await response.json()) as { id?: string }
  if (!asset.id) throw new Error('upload response did not include an asset id')
  return asset.id
}

/**
 * Uploads a fixture via the hidden file input (header input comes first) and returns the
 * asset id. Tolerates the same-user dedup-skip: when the browser resolves the upload from
 * the exists check it sends NO POST /api/v1/files (neither 201 nor 409), so this races the
 * files POST against the exists POST and returns the hit's existingAssetId — the same
 * outcome as a 409, keeping `allowDuplicate` semantics for both paths.
 */
export async function uploadFixture(
  page: Page,
  name: string,
  options: { allowDuplicate?: boolean } = {},
): Promise<string> {
  const isFilesPost = (r: Response): boolean =>
    r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/files'
  const isExistsPost = (r: Response): boolean =>
    r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/files/exists'
  // both waiters register BEFORE the file input triggers the flow: on the hash path the
  // exists check always precedes the files POST, and a dedup hit sends no files POST at all.
  // (Promise.race settles on the first match; the loser's later rejection is handled by the
  // race itself, so no unhandled rejection escapes.)
  const filesWaiter = page.waitForResponse(isFilesPost, { timeout: 240_000 })
  const existsWaiter = page.waitForResponse(isExistsPost, { timeout: 240_000 })
  await page.locator('input[type="file"]').first().setInputFiles(join(FIXTURES_DIR, name))
  const first = await Promise.race([
    filesWaiter.then((response) => ({ kind: 'files' as const, response })),
    existsWaiter.then((response) => ({ kind: 'exists' as const, response })),
  ])
  if (first.kind === 'files') {
    return extractFilesPostAssetId(first.response, options)
  }
  const body = (await first.response.json()) as { items?: ExistsHit[] }
  const hit = body.items?.find((item) => item.exists && item.existingAssetId)
  if (hit?.existingAssetId) {
    return hit.existingAssetId
  }
  // exists MISS: the upload-lane POST follows.
  return extractFilesPostAssetId(await filesWaiter, options)
}

const FIXTURE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/** Uploads a fixture through POST /api/v1/files as the given auth (API-level, no browser). */
export async function uploadViaApi(
  request: APIRequestContext,
  auth: AuthResponse,
  name: string,
): Promise<string> {
  const mimeType = FIXTURE_MIME[name.slice(name.lastIndexOf('.'))]
  if (!mimeType) throw new Error(`no MIME type registered for fixture "${name}"`)
  const response = await request.post('/api/v1/files', {
    headers: authHeaders(auth),
    multipart: {
      file: { name, mimeType, buffer: await readFile(join(FIXTURES_DIR, name)) },
    },
  })
  expect(response.status()).toBe(201)
  const asset = (await response.json()) as { id?: string }
  if (!asset.id) throw new Error('upload response did not include an asset id')
  return asset.id
}

export async function expectSingleTimelineItem(page: Page): Promise<void> {
  await expect(page.locator('figure[role="button"]')).toHaveCount(1, { timeout: 60_000 })
}

/** Thumbnails load behind IntersectionObserver + scroll-idle gating — scroll first, then wait. */
export async function expectThumbnailLoaded(page: Page): Promise<void> {
  const img = page.locator('figure[role="button"] img').first()
  await img.waitFor({ state: 'attached', timeout: 60_000 })
  await img.scrollIntoViewIfNeeded()
  await expectImageLoaded(img)
}

/** Waits until the element has decoded bytes (naturalWidth 0 = still in flight or failed). */
export async function expectImageLoaded(img: Locator, timeout = 60_000): Promise<void> {
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout })
    .toBeGreaterThan(0)
}

/** Waits until the worker has registered the given thumbnail sizes for the asset. */
export async function waitForThumbnails(
  request: APIRequestContext,
  auth: AuthResponse,
  assetId: string,
  sizes: string[],
): Promise<void> {
  await expect
    .poll(
      async () => {
        const asset = await getAsset(request, auth, assetId)
        const present = new Set((asset.thumbnails ?? []).map((t) => t.size))
        return sizes.every((size) => present.has(size))
      },
      { timeout: 60_000 },
    )
    .toBe(true)
}

/** Clicks the first tile, waits for the viewer URL, then caches and returns the ?asset= id. */
export async function openViewerAndCaptureAssetId(page: Page, ctx: Ctx): Promise<string> {
  await page.locator('figure[role="button"]').first().click()
  await expect(page).toHaveURL(/[?&]asset=/)
  const id = new URL(page.url()).searchParams.get('asset')
  if (!id) throw new Error('no ?asset= id in the URL after opening the viewer')
  ctx.assetId = id
  return id
}

/** Opens the viewer on the first tile, caches its asset id, then closes the viewer again. */
export async function discoverAssetId(page: Page, ctx: Ctx): Promise<string> {
  if (ctx.assetId) return ctx.assetId
  const id = await openViewerAndCaptureAssetId(page, ctx)
  await page.keyboard.press('Escape')
  await expect(page.locator('div.fixed.inset-0.z-50')).toHaveCount(0)
  return id
}

export async function getAsset(
  request: APIRequestContext,
  auth: AuthResponse,
  id: string,
): Promise<Asset> {
  const response = await request.get(`/api/v1/assets/${id}`, { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as Asset
}
