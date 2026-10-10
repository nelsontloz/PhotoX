import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { createBdd, test as base } from 'playwright-bdd'
import {
  FACE_EMBEDDING_DIM,
  type Asset,
  type AuthResponse,
  type FaceDetectionSettings,
  type FaceDetectorKind,
} from '@photox/shared-types'

export const PASSWORD = 'password123'
// apps/web is "type": "module" — steps load as ESM, so no __dirname
export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url))

// re-exported for step files so they keep importing wire types from support, not shared-types
export type { AuthResponse, FaceDetectionSettings, FaceDetectorKind }

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

export type ReprocessKind = 'embedding' | 'ocr' | 'detection'

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
  faceDetectorOriginal?: FaceDetectorKind
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
  // semantic
  semanticUploads?: SemanticUpload[]
  faceCountsBefore?: FaceDetectionSettings['facesByDetector']
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

export const { Given, When, Then, AfterStep } = createBdd(test)

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

/** Seeds the zustand-persisted session before any app script runs. */
export async function injectSession(page: Page, auth: AuthResponse): Promise<void> {
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

/** GETs the admin face-detection settings (same wire shape as the PUT response). */
export async function fetchFaceSettings(
  request: APIRequestContext,
  auth: AuthResponse,
): Promise<FaceDetectionSettings> {
  const response = await request.get('/api/v1/admin/face-detection', { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as FaceDetectionSettings
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

/** Uploads a fixture via the hidden file input (header input comes first) and returns the asset id. */
export async function uploadFixture(
  page: Page,
  name: string,
  options: { allowDuplicate?: boolean } = {},
): Promise<string> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/files',
    ),
    page.locator('input[type="file"]').first().setInputFiles(join(FIXTURES_DIR, name)),
  ])
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
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 60_000 })
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
