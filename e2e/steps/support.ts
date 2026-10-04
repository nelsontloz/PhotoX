import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { createBdd, test as base } from 'playwright-bdd'

export const PASSWORD = 'password123'
// apps/web is "type": "module" — steps load as ESM, so no __dirname
export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url))

export interface SessionUser {
  id: string
  email: string
  role: string
  displayName?: string
}

/** Wire shape of POST /api/v1/auth/register (and the localStorage session subset). */
export interface AuthState {
  user: SessionUser
  accessToken: string
  refreshToken: string
}

/** Subset of the asset DTO the steps poll. */
export interface AssetDto {
  id: string
  fileId?: string
  thumbnailStatus?: string | null
  thumbnails?: { size?: string }[]
  transcodeStatus?: string | null
  transcodeFileId?: string | null
}

export interface Ctx {
  auth?: AuthState
  assetId?: string
  lastStatus?: number
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
export async function registerUser(request: APIRequestContext, email?: string): Promise<AuthState> {
  const response = await request.post('/api/v1/auth/register', {
    data: {
      email: email ?? `e2e-${randomUUID()}@photox.test`,
      password: PASSWORD,
      displayName: 'E2E User',
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as AuthState
}

/** Seeds the zustand-persisted session before any app script runs. */
export async function injectSession(page: Page, auth: AuthState): Promise<void> {
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

export function authHeaders(auth: AuthState): Record<string, string> {
  return { Authorization: `Bearer ${auth.accessToken}` }
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
  auth: AuthState,
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

/** Opens the viewer on the first tile, caches its asset id, then closes the viewer again. */
export async function discoverAssetId(page: Page, ctx: Ctx): Promise<string> {
  if (ctx.assetId) return ctx.assetId
  await page.locator('figure[role="button"]').first().click()
  await expect(page).toHaveURL(/[?&]asset=/)
  const id = new URL(page.url()).searchParams.get('asset')
  if (!id) throw new Error('no ?asset= id in the URL after opening the viewer')
  ctx.assetId = id
  await page.keyboard.press('Escape')
  await expect(page.locator('div.fixed.inset-0.z-50')).toHaveCount(0)
  return id
}

export async function getAsset(
  request: APIRequestContext,
  auth: AuthState,
  id: string,
): Promise<AssetDto> {
  const response = await request.get(`/api/v1/assets/${id}`, { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as AssetDto
}
