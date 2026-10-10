import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Response } from '@playwright/test'
import {
  Given,
  Then,
  When,
  addAssetsViaApi,
  authHeaders,
  createAlbumViaApi,
  expectThumbnailLoaded,
  registerUser,
  requireAuth,
  requireOtherAuth,
  uploadViaApi,
  waitForThumbnails,
  type AlbumRef,
  type AuthResponse,
  type Ctx,
} from '../support'

interface AlbumAssetsPayload {
  items: { id: string }[]
  total: number
}

function currentAlbum(ctx: Ctx): AlbumRef {
  const albums = ctx.albums
  const album = albums?.[albums.length - 1]
  if (!album) throw new Error('create an album first')
  return album
}

function albumAssetAt(ctx: Ctx, index: number): string {
  const assetId = ctx.albumAssets?.[index]
  if (!assetId) throw new Error(`upload album photos first (no photo at index ${index})`)
  return assetId
}

const isCreateAlbum = (response: Response): boolean =>
  response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/albums'

const isAlbumAssetsPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  /^\/api\/v1\/albums\/[^/]+\/assets$/.test(new URL(response.url()).pathname)

async function fetchAlbumAssets(
  request: APIRequestContext,
  auth: AuthResponse,
  albumId: string,
): Promise<AlbumAssetsPayload> {
  const response = await request.get(`/api/v1/albums/${albumId}/assets?limit=100`, {
    headers: authHeaders(auth),
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as AlbumAssetsPayload
}

// --- seeding ----------------------------------------------------------------

Given('I created an album via the API named {string}', async ({ request, ctx }, name: string) => {
  const album = await createAlbumViaApi(request, requireAuth(ctx), name)
  const albums = (ctx.albums ??= [])
  albums.push(album)
})

Given('I registered a second album user', async ({ request, ctx }) => {
  ctx.otherAuth = await registerUser(request)
})

Given('I uploaded an album photo', async ({ request, ctx }) => {
  const assetId = await uploadViaApi(request, requireAuth(ctx), 'photo.jpg')
  ctx.albumAssets = [assetId]
  ctx.assetId = assetId
})

Given('I uploaded two album photos', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const first = await uploadViaApi(request, auth, 'photo.jpg')
  const second = await uploadViaApi(request, auth, 'photo-text.jpg')
  ctx.albumAssets = [first, second]
  ctx.assetId = first
})

Given('the other album user uploaded an album photo', async ({ request, ctx }) => {
  const assetId = await uploadViaApi(request, requireOtherAuth(ctx), 'photo.jpg')
  ctx.otherAssetId = assetId
})

// --- album API actions ------------------------------------------------------

When('I add my album photo to the album', async ({ request, ctx }) => {
  const status = await addAssetsViaApi(request, requireAuth(ctx), currentAlbum(ctx).id, [
    albumAssetAt(ctx, 0),
  ])
  ctx.lastStatus = status
  expect(status).toBe(201)
})

When('I add my second album photo to the album', async ({ request, ctx }) => {
  const status = await addAssetsViaApi(request, requireAuth(ctx), currentAlbum(ctx).id, [
    albumAssetAt(ctx, 1),
  ])
  ctx.lastStatus = status
  expect(status).toBe(201)
})

When('I add my album photo to the album again', async ({ request, ctx }) => {
  const status = await addAssetsViaApi(request, requireAuth(ctx), currentAlbum(ctx).id, [
    albumAssetAt(ctx, 0),
  ])
  ctx.lastStatus = status
  expect(status).toBe(201)
})

When('I add my trashed album photo to the album', async ({ request, ctx }) => {
  ctx.lastStatus = await addAssetsViaApi(request, requireAuth(ctx), currentAlbum(ctx).id, [
    albumAssetAt(ctx, 0),
  ])
})

When("I add the other album user's photo to my album", async ({ request, ctx }) => {
  const assetId = ctx.otherAssetId
  if (!assetId) throw new Error("the other album user's photo was not uploaded")
  ctx.lastStatus = await addAssetsViaApi(request, requireAuth(ctx), currentAlbum(ctx).id, [assetId])
})

When('I trash my album photo', async ({ request, ctx }) => {
  const response = await request.post(`/api/v1/assets/${albumAssetAt(ctx, 0)}/trash`, {
    headers: authHeaders(requireAuth(ctx)),
  })
  ctx.lastStatus = response.status()
})

When('the other album user requests my album', async ({ request, ctx }) => {
  const response = await request.get(`/api/v1/albums/${currentAlbum(ctx).id}`, {
    headers: authHeaders(requireOtherAuth(ctx)),
  })
  ctx.lastStatus = response.status()
})

When('the other album user renames my album', async ({ request, ctx }) => {
  const response = await request.patch(`/api/v1/albums/${currentAlbum(ctx).id}`, {
    headers: authHeaders(requireOtherAuth(ctx)),
    data: { name: 'Hijacked album' },
  })
  ctx.lastStatus = response.status()
})

When('the other album user deletes my album', async ({ request, ctx }) => {
  const response = await request.delete(`/api/v1/albums/${currentAlbum(ctx).id}`, {
    headers: authHeaders(requireOtherAuth(ctx)),
  })
  ctx.lastStatus = response.status()
})

When("the other album user requests my album's photos", async ({ request, ctx }) => {
  const response = await request.get(`/api/v1/albums/${currentAlbum(ctx).id}/assets`, {
    headers: authHeaders(requireOtherAuth(ctx)),
  })
  ctx.lastStatus = response.status()
})

When('the other album user adds their own photo to my album', async ({ request, ctx }) => {
  const other = requireOtherAuth(ctx)
  const assetId = ctx.otherAssetId ?? (await uploadViaApi(request, other, 'photo.jpg'))
  ctx.otherAssetId = assetId
  ctx.lastStatus = await addAssetsViaApi(request, other, currentAlbum(ctx).id, [assetId])
})

When(
  'I list my albums with limit {int} and offset {int}',
  async ({ request, ctx }, limit: number, offset: number) => {
    const response = await request.get(`/api/v1/albums?limit=${limit}&offset=${offset}`, {
      headers: authHeaders(requireAuth(ctx)),
    })
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { items: AlbumRef[] }
    ctx.albumPage = body.items.map((album) => ({ id: album.id, name: album.name }))
  },
)

When('I create an album without a name', async ({ request, ctx }) => {
  const response = await request.post('/api/v1/albums', {
    headers: authHeaders(requireAuth(ctx)),
    data: { description: 'no name attached' },
  })
  ctx.lastStatus = response.status()
})

// --- album API assertions ---------------------------------------------------

Then('the album asset count is {int}', async ({ request, ctx }, count: number) => {
  const payload = await fetchAlbumAssets(request, requireAuth(ctx), currentAlbum(ctx).id)
  expect(payload.total).toBe(count)
})

Then('the listed albums in order are {string}', ({ ctx }, names: string) => {
  const page = ctx.albumPage
  if (!page) throw new Error('list the albums first')
  expect(page.map((album) => album.name)).toEqual(names.split(',').map((name) => name.trim()))
})

Then('my album lists the photos newest-added first', async ({ request, ctx }) => {
  const payload = await fetchAlbumAssets(request, requireAuth(ctx), currentAlbum(ctx).id)
  expect(payload.items.map((item) => item.id)).toEqual([albumAssetAt(ctx, 1), albumAssetAt(ctx, 0)])
})

Then('my timeline still contains the album photo', async ({ request, ctx }) => {
  const response = await request.get('/api/v1/assets', { headers: authHeaders(requireAuth(ctx)) })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { items: { id: string }[] }
  expect(body.items.map((item) => item.id)).toContain(albumAssetAt(ctx, 0))
})

// --- albums page UI ---------------------------------------------------------

When('I create an album through the UI named {string}', async ({ page, ctx }, name: string) => {
  await page.getByRole('button', { name: 'New Album' }).first().click()
  await page.getByPlaceholder('e.g. Summer 2025').fill(name)
  const [response] = await Promise.all([
    page.waitForResponse(isCreateAlbum),
    page.getByRole('button', { name: 'Create', exact: true }).click(),
  ])
  expect(response.status()).toBe(201)
  const album = (await response.json()) as AlbumRef
  const albums = (ctx.albums ??= [])
  albums.push({ id: album.id, name: album.name })
})

Then('the albums page shows the album card {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
})

When('I open the album card {string}', async ({ page }, name: string) => {
  await page.locator('a[href^="/albums/"]').filter({ hasText: name }).click()
  await expect(page).toHaveURL(/\/albums\/[^/?]+/)
})

Then('the albums page lists {int} album cards', async ({ page }, count: number) => {
  await expect(page.locator('a[href^="/albums/"]')).toHaveCount(count)
})

When('I search albums for {string}', async ({ page }, query: string) => {
  await page.getByPlaceholder('Search albums…').fill(query)
})

Then('only the album card {string} is visible', async ({ page }, name: string) => {
  const cards = page.locator('a[href^="/albums/"]')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText(name)
})

// --- album detail UI --------------------------------------------------------

When('I open the album', async ({ page, ctx }) => {
  const album = currentAlbum(ctx)
  await page.goto(`/albums/${album.id}`)
  await expect(page.getByRole('heading', { level: 1, name: album.name, exact: true })).toBeVisible()
})

Then('the album page shows the empty state', async ({ page }) => {
  await expect(page.getByText('No photos in this album yet')).toBeVisible()
})

When('I rename the album to {string}', async ({ page, ctx }, name: string) => {
  const album = currentAlbum(ctx)
  await page.getByRole('heading', { level: 1, name: album.name, exact: true }).click()
  const input = page.getByRole('main').getByRole('textbox')
  await input.fill(name)
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === `/api/v1/albums/${album.id}`,
    ),
    input.press('Enter'),
  ])
  expect(response.status()).toBe(200)
  album.name = name
})

When('I start renaming the album to {string}', async ({ page, ctx }, name: string) => {
  const album = currentAlbum(ctx)
  await page.getByRole('heading', { level: 1, name: album.name, exact: true }).click()
  await page.getByRole('main').getByRole('textbox').fill(name)
})

When('I cancel the album rename with Escape', async ({ page }) => {
  await page.getByRole('main').getByRole('textbox').press('Escape')
})

Then('the album title is {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
})

When('I reload the album page', async ({ page }) => {
  await page.reload()
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible()
})

When('I edit the album description to {string}', async ({ page, ctx }, description: string) => {
  const album = currentAlbum(ctx)
  await page.locator('button[aria-label="Album options"]').click()
  page.once('dialog', (dialog) => void dialog.accept(description))
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === `/api/v1/albums/${album.id}`,
    ),
    page.getByRole('button', { name: 'Edit description' }).click(),
  ])
  expect(response.status()).toBe(200)
})

Then('the album description is {string}', async ({ page }, description: string) => {
  await expect(page.getByText(description, { exact: true })).toBeVisible()
})

When('I delete the album from its options menu', async ({ page }) => {
  await page.locator('button[aria-label="Album options"]').click()
  await page.getByRole('button', { name: 'Delete album' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page).toHaveURL('/albums')
})

Then('the albums page shows no album cards', async ({ page }) => {
  await expect(page.getByText('No albums yet')).toBeVisible()
  await expect(page.locator('a[href^="/albums/"]')).toHaveCount(0)
})

When('I open the add photos dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

Then('the add photos dialog lists {int} album photos', async ({ page }, count: number) => {
  await expect(page.getByRole('dialog').locator('figure[role="button"]')).toHaveCount(count)
})

When('I select all album photos in the dialog', async ({ page }) => {
  const figures = page.getByRole('dialog').locator('figure[role="button"]')
  const count = await figures.count()
  if (count === 0) throw new Error('the add photos dialog has no photos to select')
  for (let i = 0; i < count; i++) {
    await figures.nth(i).click()
  }
  await expect(page.getByRole('dialog').getByText(`${count} photos selected`)).toBeVisible()
})

When('I add the selected album photos', async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse(isAlbumAssetsPost),
    page
      .getByRole('dialog')
      .getByRole('button', { name: /^Add \d+$/ })
      .click(),
  ])
  expect(response.status()).toBe(201)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

Then('the album page shows {int} album photos', async ({ page }, count: number) => {
  await expect(page.locator('figure[role="button"]')).toHaveCount(count)
  await expect(
    page.getByText(`${count} ${count === 1 ? 'item' : 'items'}`, { exact: true }),
  ).toBeVisible()
})

Then('the first album photo thumbnail loads', async ({ page, request, ctx }) => {
  // the album page fetches its assets once; at that point the API-uploaded photos may not have
  // registered thumbnails yet, and AssetThumb only renders an <img> once one exists — so wait
  // server-side for the album's thumbs, then reload so the page picks them up
  const auth = requireAuth(ctx)
  const album = currentAlbum(ctx)
  const payload = await fetchAlbumAssets(request, auth, album.id)
  if (payload.items.length === 0) {
    throw new Error('the album has no photos to load a thumbnail for')
  }
  for (const item of payload.items) {
    await waitForThumbnails(request, auth, item.id, ['md'])
  }
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: album.name, exact: true })).toBeVisible()
  await expectThumbnailLoaded(page)
})

When('I open the first album photo in the viewer', async ({ page, ctx }) => {
  await page.locator('figure[role="button"]').first().click()
  await expect(page).toHaveURL(/[?&]asset=/)
  const assetId = new URL(page.url()).searchParams.get('asset')
  if (ctx.assetId && assetId !== ctx.assetId) throw new Error('opened the wrong album photo')
  await expect(page.locator('div.fixed.inset-0.z-50')).toBeVisible()
})

When('I remove the open photo from the album', async ({ page }) => {
  await page.locator('button[aria-label="Remove from this album"]:visible').click()
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.locator('div.fixed.inset-0.z-50')).toHaveCount(0)
})

When('I open a missing album page', async ({ page }) => {
  await page.goto(`/albums/${randomUUID()}`)
})

Then('the album page shows the not-found state', async ({ page }) => {
  await expect(page.getByText('Album not found')).toBeVisible()
})

// --- timeline viewer picker -------------------------------------------------

When('I open the album picker from the viewer', async ({ page }) => {
  await page.locator('button[aria-label="Add to album"]:visible').click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

When('I create an album named {string} in the picker', async ({ page }, name: string) => {
  const dialog = page.getByRole('dialog')
  const createFirst = dialog.getByRole('button', { name: 'Create your first album' })
  if (await createFirst.isVisible()) await createFirst.click()
  else await dialog.getByRole('button', { name: 'New album' }).click()
  await dialog.getByPlaceholder('e.g. Summer 2025').fill(name)
  const [createResponse, addResponse] = await Promise.all([
    page.waitForResponse(isCreateAlbum),
    page.waitForResponse(isAlbumAssetsPost),
    dialog.getByRole('button', { name: 'Create', exact: true }).click(),
  ])
  expect(createResponse.status()).toBe(201)
  expect(addResponse.status()).toBe(201)
  await expect(dialog).toHaveCount(0)
})

Then('the open photo is in the album {string}', async ({ request, ctx }, name: string) => {
  const auth = requireAuth(ctx)
  const assetId = ctx.assetId
  if (!assetId) throw new Error('open a photo first')
  const listResponse = await request.get('/api/v1/albums?limit=1000', {
    headers: authHeaders(auth),
  })
  expect(listResponse.status()).toBe(200)
  const list = (await listResponse.json()) as { items: AlbumRef[] }
  const album = list.items.find((candidate) => candidate.name === name)
  if (!album) throw new Error(`album "${name}" was not found via the API`)
  const assetsResponse = await request.get(`/api/v1/albums/${album.id}/assets`, {
    headers: authHeaders(auth),
  })
  expect(assetsResponse.status()).toBe(200)
  const assets = (await assetsResponse.json()) as { items: { id: string }[] }
  expect(assets.items.map((item) => item.id)).toContain(assetId)
})
