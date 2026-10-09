import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse, type Response } from '@playwright/test'
import {
  Given,
  Then,
  When,
  authHeaders,
  registerUser,
  type AuthState,
  type Ctx,
  uploadViaApi,
} from '../support'

/** Code-matched subset of the share DTOs (e2e steps never import apps/* or shared-types). */
interface ShareDto {
  id: string
  kind: 'asset' | 'album'
  token: string
  assetId?: string
  albumId?: string
  albumName?: string
}

interface ShareList {
  items: ShareDto[]
}

const ALBUM_NAME = 'E2E share album'

/** ctx has no share slots; keep them local instead of editing support.ts. */
type SharingCtx = Ctx & {
  assetShare?: ShareDto
  assetShareAgain?: ShareDto
  albumShare?: ShareDto
  videoShare?: ShareDto
  lastShare?: ShareDto
  shareOwner?: AuthState
  albumId?: string
  albumName?: string
  albumMemberId?: string
  otherAuth?: AuthState
  otherShare?: ShareDto
  streamContentRange?: string | null
}

const sctx = (ctx: Ctx): SharingCtx => ctx

function requireAuth(ctx: Ctx): AuthState {
  if (!ctx.auth) throw new Error('ctx.auth is missing — sign in first')
  return ctx.auth
}

function requireAssetId(ctx: Ctx): string {
  if (!ctx.assetId) throw new Error('ctx.assetId is missing — upload an asset first')
  return ctx.assetId
}

function requireShare(share: ShareDto | undefined, hint: string): ShareDto {
  if (!share) throw new Error(`create a ${hint} share first`)
  return share
}

function requireOtherAuth(ctx: Ctx): AuthState {
  const auth = sctx(ctx).otherAuth
  if (!auth) throw new Error('register the second user for share testing first')
  return auth
}

const isCreateShareResponse = (response: Response): boolean =>
  response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/shares'

function postShare(
  request: APIRequestContext,
  auth: AuthState,
  data: { assetId?: string; albumId?: string },
): Promise<APIResponse> {
  return request.post('/api/v1/shares', { headers: authHeaders(auth), data })
}

async function expectShareCreated(
  response: Pick<APIResponse, 'status' | 'json'>,
): Promise<ShareDto> {
  expect(response.status()).toBe(201)
  const share = (await response.json()) as ShareDto
  if (!share.id || !share.token) throw new Error('share response is missing an id or token')
  return share
}

async function fetchShares(request: APIRequestContext, auth: AuthState): Promise<ShareList> {
  const response = await request.get('/api/v1/shares', { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as ShareList
}

async function createAlbum(
  request: APIRequestContext,
  auth: AuthState,
  name: string,
): Promise<string> {
  const response = await request.post('/api/v1/albums', {
    headers: authHeaders(auth),
    data: { name },
  })
  expect(response.status()).toBe(201)
  const album = (await response.json()) as { id?: string }
  if (!album.id) throw new Error('album response did not include an id')
  return album.id
}

async function addAssetToAlbum(
  request: APIRequestContext,
  auth: AuthState,
  albumId: string,
  assetId: string,
): Promise<void> {
  const response = await request.post(`/api/v1/albums/${albumId}/assets`, {
    headers: authHeaders(auth),
    data: { assetIds: [assetId] },
  })
  expect(response.status()).toBe(201)
}

/** Registers a fresh user, uploads the fixture and creates the share — no browser session. */
async function seedAssetShare(
  request: APIRequestContext,
  ctx: Ctx,
  kind: 'photo' | 'video',
): Promise<void> {
  const auth = await registerUser(request)
  const fixture = kind === 'video' ? 'video-h264.mp4' : 'photo.jpg'
  const assetId = await uploadViaApi(request, auth, fixture)
  const share = await expectShareCreated(await postShare(request, auth, { assetId }))
  sctx(ctx).shareOwner = auth
  if (kind === 'video') sctx(ctx).videoShare = share
  else sctx(ctx).assetShare = share
  sctx(ctx).lastShare = share
}

async function seedAlbumShare(request: APIRequestContext, ctx: Ctx): Promise<void> {
  const auth = await registerUser(request)
  const assetId = await uploadViaApi(request, auth, 'photo.jpg')
  const albumId = await createAlbum(request, auth, ALBUM_NAME)
  await addAssetToAlbum(request, auth, albumId, assetId)
  const share = await expectShareCreated(await postShare(request, auth, { albumId }))
  sctx(ctx).shareOwner = auth
  sctx(ctx).albumId = albumId
  sctx(ctx).albumName = ALBUM_NAME
  sctx(ctx).albumMemberId = assetId
  sctx(ctx).albumShare = share
  sctx(ctx).lastShare = share
}

// --- Setup: shares created through the API without a browser session --------------------

Given('a share exists for an uploaded photo', async ({ request, ctx }) => {
  await seedAssetShare(request, ctx, 'photo')
})

Given('a share exists for an uploaded video', async ({ request, ctx }) => {
  await seedAssetShare(request, ctx, 'video')
})

Given('a share exists for an album containing an uploaded photo', async ({ request, ctx }) => {
  await seedAlbumShare(request, ctx)
})

Given('a second user registers for share testing', async ({ request, ctx }) => {
  sctx(ctx).otherAuth = await registerUser(request)
})

// --- Own shares page: UI ------------------------------------------------------------------

Then('the share list shows the empty state', async ({ page }) => {
  await expect(page.getByText('No shared links yet')).toBeVisible()
  await expect(
    page.getByText('Open a photo or an album and use Share to create a public link.'),
  ).toBeVisible()
})

When('I prepare an album share target with the uploaded photo', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const assetId = requireAssetId(ctx)
  const albumId = await createAlbum(request, auth, ALBUM_NAME)
  await addAssetToAlbum(request, auth, albumId, assetId)
  sctx(ctx).albumId = albumId
  sctx(ctx).albumName = ALBUM_NAME
})

When('I open the album detail for that share target', async ({ page, ctx }) => {
  const { albumId, albumName } = sctx(ctx)
  if (!albumId || !albumName) throw new Error('prepare an album share target first')
  await page.goto(`/albums/${albumId}`)
  await expect(page.getByRole('heading', { level: 1, name: albumName })).toBeVisible()
})

When('I create an album share from the album options', async ({ page, context, ctx }) => {
  // the page writes the link with navigator.clipboard — grant it so "Link copied" can appear
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.bringToFront()
  await page.locator('[aria-label="Album options"]').click()
  const [response] = await Promise.all([
    page.waitForResponse(isCreateShareResponse),
    page.getByRole('button', { name: 'Share album' }).click(),
  ])
  const share = await expectShareCreated(response)
  sctx(ctx).albumShare = share
  sctx(ctx).lastShare = share
})

Then('the album page confirms the share link was copied', async ({ page }) => {
  await expect(page.getByText('Link copied')).toBeVisible()
})

Then('the shares API lists that share with a token', async ({ request, ctx }) => {
  const share = requireShare(sctx(ctx).lastShare, 'UI or API')
  const list = await fetchShares(request, requireAuth(ctx))
  const found = list.items.find((item) => item.id === share.id)
  if (!found) throw new Error(`share ${share.id} is not listed by GET /api/v1/shares`)
  expect(found.token).toBe(share.token)
})

Then('the share list shows an album share entry', async ({ page }) => {
  await expect(page.getByText('Album', { exact: true })).toBeVisible()
  await expect(page.locator('[title="Revoke share"]')).toHaveCount(1)
})

Then('the share list shows an asset share entry', async ({ page }) => {
  await expect(page.getByText('Photo', { exact: true })).toBeVisible()
  await expect(page.locator('[title="Revoke share"]')).toHaveCount(1)
})

When('I create an asset share from the viewer', async ({ page, ctx }) => {
  const [response] = await Promise.all([
    page.waitForResponse(isCreateShareResponse),
    page.locator('button[title="Share"]:visible').click(),
  ])
  const share = await expectShareCreated(response)
  if (ctx.assetId && share.assetId !== ctx.assetId) {
    throw new Error('the viewer created a share for a different asset than the open one')
  }
  sctx(ctx).assetShare = share
  sctx(ctx).lastShare = share
})

When('I revoke that share from the share list', async ({ page, ctx }) => {
  const share = requireShare(sctx(ctx).lastShare, 'UI or API')
  await page.locator('[title="Revoke share"]').first().click()
  await expect(
    page.getByRole('heading', { level: 3, name: 'Revoke this share link?' }),
  ).toBeVisible()
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' &&
        new URL(r.url()).pathname === `/api/v1/shares/${share.id}`,
    ),
    page.getByRole('button', { name: 'Revoke', exact: true }).click(),
  ])
  expect(response.status()).toBe(204)
})

Then('the share list no longer lists that share', async ({ page }) => {
  await expect(page.locator('[title="Revoke share"]')).toHaveCount(0)
  await expect(page.getByText('No shared links yet')).toBeVisible()
})

Then('the shares API does not list that share', async ({ request, ctx }) => {
  const share = requireShare(sctx(ctx).lastShare, 'UI or API')
  const list = await fetchShares(request, requireAuth(ctx))
  expect(list.items.some((item) => item.id === share.id)).toBe(false)
})

// --- Own shares page: API-level lifecycle -------------------------------------------------

When('I create an asset share for the uploaded photo', async ({ request, ctx }) => {
  const response = await postShare(request, requireAuth(ctx), { assetId: requireAssetId(ctx) })
  ctx.lastStatus = response.status()
  const share = await expectShareCreated(response)
  sctx(ctx).assetShare = share
  sctx(ctx).lastShare = share
})

When('I create an asset share for the uploaded photo again', async ({ request, ctx }) => {
  const response = await postShare(request, requireAuth(ctx), { assetId: requireAssetId(ctx) })
  ctx.lastStatus = response.status()
  const share = await expectShareCreated(response)
  sctx(ctx).assetShareAgain = share
  sctx(ctx).lastShare = share
})

When('I create an album share for that share target', async ({ request, ctx }) => {
  const albumId = sctx(ctx).albumId
  if (!albumId) throw new Error('prepare an album share target first')
  const share = await expectShareCreated(await postShare(request, requireAuth(ctx), { albumId }))
  sctx(ctx).albumShare = share
  sctx(ctx).lastShare = share
})

When('I trash the uploaded share photo via the API', async ({ request, ctx }) => {
  const response = await request.post(`/api/v1/assets/${requireAssetId(ctx)}/trash`, {
    headers: authHeaders(requireAuth(ctx)),
  })
  expect(response.status()).toBe(204)
})

Then('the share list shows only the album share', async ({ page }) => {
  await expect(page.locator('[title="Revoke share"]')).toHaveCount(1)
  await expect(page.getByText('Album', { exact: true })).toBeVisible()
  await expect(page.getByText('Photo', { exact: true })).toHaveCount(0)
})

When('I submit a share request with both an asset and an album id', async ({ request, ctx }) => {
  const response = await postShare(request, requireAuth(ctx), {
    assetId: randomUUID(),
    albumId: randomUUID(),
  })
  ctx.lastStatus = response.status()
})

Then('both share requests returned the same share id and token', ({ ctx }) => {
  const first = requireShare(sctx(ctx).assetShare, 'first asset')
  const second = requireShare(sctx(ctx).assetShareAgain, 'second asset')
  expect(second.id).toBe(first.id)
  expect(second.token).toBe(first.token)
})

Then('the shares API lists exactly one share entry', async ({ request, ctx }) => {
  const list = await fetchShares(request, requireAuth(ctx))
  expect(list.items.length).toBe(1)
})

When(
  'the second user creates an asset share for their own uploaded photo',
  async ({ request, ctx }) => {
    const other = requireOtherAuth(ctx)
    const assetId = await uploadViaApi(request, other, 'photo.jpg')
    const share = await expectShareCreated(await postShare(request, other, { assetId }))
    sctx(ctx).otherShare = share
  },
)

Then("the second user's shares API lists only their own share", async ({ request, ctx }) => {
  const list = await fetchShares(request, requireOtherAuth(ctx))
  expect(list.items.length).toBe(1)
  const only = list.items[0]
  if (!only) throw new Error("the second user's share list is empty")
  expect(only.id).toBe(requireShare(sctx(ctx).otherShare, "second user's").id)
  const mine = sctx(ctx).assetShare
  if (mine) expect(only.id).not.toBe(mine.id)
})

When("the second user attempts to revoke the first user's share", async ({ request, ctx }) => {
  const mine = requireShare(sctx(ctx).assetShare, 'first user asset')
  const response = await request.delete(`/api/v1/shares/${mine.id}`, {
    headers: authHeaders(requireOtherAuth(ctx)),
  })
  ctx.lastStatus = response.status()
})

When(
  "the second user requests a share of the first user's album target",
  async ({ request, ctx }) => {
    const albumId = sctx(ctx).albumId
    if (!albumId) throw new Error('prepare an album share target first')
    const response = await postShare(request, requireOtherAuth(ctx), { albumId })
    ctx.lastStatus = response.status()
  },
)

// --- Public share pages and APIs (anonymous) ---------------------------------------------

When('an anonymous client calls the public share API for that share', async ({ request, ctx }) => {
  const share = requireShare(sctx(ctx).lastShare, 'UI or API')
  ctx.lastStatus = (await request.get(`/api/share/${share.token}`)).status()
})

When('I open the public share page for that share', async ({ page, ctx }) => {
  const share = requireShare(sctx(ctx).lastShare, 'UI or API')
  await page.goto(`/share/${share.token}`)
})

Then('the public share page shows the shared photo', async ({ page, ctx }) => {
  const share = requireShare(sctx(ctx).lastShare, 'UI or API')
  // the anonymous context must stay on the capability URL, not bounce to /login
  expect(new URL(page.url()).pathname).toBe(`/share/${share.token}`)
  const img = page.locator(`img[src*="/api/share/${share.token}/stream"]`)
  await expect(img).toBeVisible()
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0)
})

Then('the public share page shows the share album header and grid', async ({ page, ctx }) => {
  const albumName = sctx(ctx).albumName
  if (!albumName) throw new Error('seed an album share first')
  await expect(page.getByRole('heading', { level: 1, name: albumName })).toBeVisible()
  const grid = page.locator('main button')
  await expect(grid.first()).toBeVisible()
  expect(await grid.count()).toBeGreaterThanOrEqual(1)
  const img = grid.first().locator('img')
  await img.scrollIntoViewIfNeeded()
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0)
})

When('I open the first share album photo', async ({ page }) => {
  await page.locator('main button').first().click()
})

Then('the public share lightbox is open', async ({ page }) => {
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').locator('img')).toBeVisible()
})

Then('the public share lightbox is closed', async ({ page }) => {
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

Then('the public share page shows not found', async ({ page }) => {
  await expect(page.getByText('Share not found')).toBeVisible()
})

When('that share is revoked through the API', async ({ request, ctx }) => {
  const share = requireShare(sctx(ctx).lastShare, 'UI or API')
  const owner = sctx(ctx).shareOwner
  if (!owner) throw new Error('seed a share first')
  const response = await request.delete(`/api/v1/shares/${share.id}`, {
    headers: authHeaders(owner),
  })
  expect(response.status()).toBe(204)
})

When(
  'an anonymous client requests the public share member stream for the share photo',
  async ({ request, ctx }) => {
    const share = requireShare(sctx(ctx).albumShare ?? sctx(ctx).lastShare, 'album')
    const memberId = sctx(ctx).albumMemberId
    if (!memberId) throw new Error('seed an album share first')
    ctx.lastStatus = (
      await request.get(`/api/share/${share.token}/assets/${memberId}/stream?size=sm`)
    ).status()
  },
)

When(
  'an anonymous client requests the public share member stream for an unrelated asset',
  async ({ request, ctx }) => {
    const share = requireShare(sctx(ctx).albumShare ?? sctx(ctx).lastShare, 'album')
    ctx.lastStatus = (
      await request.get(`/api/share/${share.token}/assets/${randomUUID()}/stream?size=sm`)
    ).status()
  },
)

When(
  'an anonymous client requests the share stream with Range {string}',
  async ({ request, ctx }, range: string) => {
    const share = requireShare(sctx(ctx).videoShare ?? sctx(ctx).lastShare, 'video')
    const response = await request.get(`/api/share/${share.token}/stream`, {
      headers: { Range: range },
    })
    ctx.lastStatus = response.status()
    sctx(ctx).streamContentRange = response.headers()['content-range'] ?? null
  },
)

Then('the share stream response carries a content range header', ({ ctx }) => {
  const contentRange = sctx(ctx).streamContentRange
  if (!contentRange) throw new Error('the share stream response has no Content-Range header')
  expect(contentRange).toMatch(/^bytes 0-99\/\d+$/)
})
