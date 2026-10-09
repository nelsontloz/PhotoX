import { expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  Given,
  Then,
  When,
  authHeaders,
  expectThumbnailLoaded,
  registerUser,
  uploadViaApi,
  type AuthState,
  type Ctx,
} from '../support'

/** Code-matched subset of the GET /api/v1/assets?favorite=true items. */
interface FavoriteAsset {
  id: string
  favorite: boolean
}

interface FavoriteList {
  items: FavoriteAsset[]
  total: number
}

/** ctx has no slots for this state; keep it local instead of editing support.ts. */
type FavoritesCtx = Ctx & {
  otherAuth?: AuthState
  otherAssetId?: string
  favoriteIds?: string[]
  listResponses?: FavoriteList[]
  otherListResponse?: FavoriteList
}

const fctx = (ctx: Ctx): FavoritesCtx => ctx

function requireAuth(ctx: Ctx): AuthState {
  if (!ctx.auth) throw new Error('ctx.auth is missing — sign in first')
  return ctx.auth
}

function requireOtherAuth(ctx: Ctx): AuthState {
  const other = fctx(ctx).otherAuth
  if (!other) throw new Error('register the other favorites user first')
  return other
}

function lastFavoritesList(ctx: Ctx): FavoriteList {
  const last = fctx(ctx).listResponses?.at(-1)
  if (!last) throw new Error('list favorites first')
  return last
}

/** The favorite control lives in the desktop top bar AND the mobile action row (hidden `sm:hidden`). */
const favoriteButton = (page: Page) =>
  page.locator('div.fixed.inset-0.z-50 button[title="Favorite"]:visible')

// An ancient fixed instant keeps the day-group label in the calendar-format branch ("Jan 2, 2020"),
// stable in any timezone — today/yesterday would flake when a test straddles midnight.
const PINNED_FAVORITES_DATE = '2020-01-02T12:00:00.000Z'

Given('another user registers for favorites isolation', async ({ request, ctx }) => {
  fctx(ctx).otherAuth = await registerUser(request)
})

When('I upload {string} via the favorites API', async ({ request, ctx }, name: string) => {
  ctx.assetId = await uploadViaApi(request, requireAuth(ctx), name)
})

When(
  'the other user uploads {string} via the favorites API',
  async ({ request, ctx }, name: string) => {
    fctx(ctx).otherAssetId = await uploadViaApi(request, requireOtherAuth(ctx), name)
  },
)

function patchFavorite(
  request: APIRequestContext,
  auth: AuthState,
  assetId: string,
  favorite: boolean,
): Promise<number> {
  return request
    .patch(`/api/v1/assets/${assetId}`, { headers: authHeaders(auth), data: { favorite } })
    .then((response) => response.status())
}

When('I favorite the uploaded asset through the favorites API', async ({ request, ctx }) => {
  if (!ctx.assetId) throw new Error('upload an asset first')
  const status = await patchFavorite(request, requireAuth(ctx), ctx.assetId, true)
  expect(status).toBe(200)
  fctx(ctx).favoriteIds = [...(fctx(ctx).favoriteIds ?? []), ctx.assetId]
})

When('I unfavorite the uploaded asset through the favorites API', async ({ request, ctx }) => {
  if (!ctx.assetId) throw new Error('upload an asset first')
  const status = await patchFavorite(request, requireAuth(ctx), ctx.assetId, false)
  expect(status).toBe(200)
  fctx(ctx).favoriteIds = (fctx(ctx).favoriteIds ?? []).filter((id) => id !== ctx.assetId)
})

When(
  'the other user favorites their uploaded asset through the favorites API',
  async ({ request, ctx }) => {
    const assetId = fctx(ctx).otherAssetId
    if (!assetId) throw new Error('the other user must upload an asset first')
    const status = await patchFavorite(request, requireOtherAuth(ctx), assetId, true)
    expect(status).toBe(200)
  },
)

When(
  'the other user tries to favorite my uploaded asset through the favorites API',
  async ({ request, ctx }) => {
    if (!ctx.assetId) throw new Error('upload an asset first')
    ctx.lastStatus = await patchFavorite(request, requireOtherAuth(ctx), ctx.assetId, true)
  },
)

When('I trash my uploaded asset through the favorites API', async ({ request, ctx }) => {
  if (!ctx.assetId) throw new Error('upload an asset first')
  const response = await request.post(`/api/v1/assets/${ctx.assetId}/trash`, {
    headers: authHeaders(requireAuth(ctx)),
  })
  ctx.lastStatus = response.status()
})

When(
  'I list my favorites with limit {int} and offset {int}',
  async ({ request, ctx }, limit: number, offset: number) => {
    const response = await request.get(
      `/api/v1/assets?favorite=true&limit=${limit}&offset=${offset}`,
      { headers: authHeaders(requireAuth(ctx)) },
    )
    expect(response.status()).toBe(200)
    fctx(ctx).listResponses = [
      ...(fctx(ctx).listResponses ?? []),
      (await response.json()) as FavoriteList,
    ]
  },
)

When('the other user lists their favorites through the favorites API', async ({ request, ctx }) => {
  const response = await request.get('/api/v1/assets?favorite=true&limit=100&offset=0', {
    headers: authHeaders(requireOtherAuth(ctx)),
  })
  expect(response.status()).toBe(200)
  fctx(ctx).otherListResponse = (await response.json()) as FavoriteList
})

Then(
  'the last favorites list holds {int} of {int} items',
  ({ ctx }, items: number, total: number) => {
    const list = lastFavoritesList(ctx)
    expect(list.items).toHaveLength(items)
    expect(list.total).toBe(total)
  },
)

Then('the favorites list pages hold my two distinct favorited assets', ({ ctx }) => {
  const [first, second] = fctx(ctx).listResponses ?? []
  if (!first || !second) throw new Error('list two favorite pages first')
  const [firstItem] = first.items
  const [secondItem] = second.items
  if (!firstItem || !secondItem) throw new Error('expected one item per favorites page')
  expect(firstItem.id).not.toBe(secondItem.id)
  const favorited = new Set(fctx(ctx).favoriteIds ?? [])
  expect(favorited.has(firstItem.id)).toBe(true)
  expect(favorited.has(secondItem.id)).toBe(true)
})

Then("the other user's favorites list is empty", ({ ctx }) => {
  const list = fctx(ctx).otherListResponse
  if (!list) throw new Error('the other user must list favorites first')
  expect(list.items).toHaveLength(0)
  expect(list.total).toBe(0)
})

Then("the other user's favorites list holds only their own asset", ({ ctx }) => {
  const list = fctx(ctx).otherListResponse
  if (!list) throw new Error('the other user must list favorites first')
  const { otherAssetId } = fctx(ctx)
  expect(list.total).toBe(1)
  expect(list.items).toHaveLength(1)
  expect(list.items[0]?.id).toBe(otherAssetId)
  expect(otherAssetId).not.toBe(ctx.assetId)
})

When('I set the uploaded asset date for favorites grouping', async ({ request, ctx }) => {
  if (!ctx.assetId) throw new Error('upload an asset first')
  const auth = requireAuth(ctx)
  // the metadata worker PATCHes takenAt (null for these EXIF-less fixtures) asynchronously — wait
  // for its status to leave 'pending' so the pinned date is not overwritten after the fact
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/assets/${ctx.assetId}`, {
          headers: authHeaders(auth),
        })
        expect(response.status()).toBe(200)
        return ((await response.json()) as { metadataStatus?: string }).metadataStatus
      },
      { timeout: 60_000 },
    )
    .not.toBe('pending')

  const response = await request.patch(`/api/v1/assets/${ctx.assetId}`, {
    headers: authHeaders(auth),
    data: { takenAt: PINNED_FAVORITES_DATE },
  })
  expect(response.status()).toBe(200)
})

When('I click the favorite control in the viewer', async ({ page, ctx }) => {
  const button = favoriteButton(page)
  await expect(button).toBeVisible()
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        /^\/api\/v1\/assets\/[^/]+$/.test(new URL(r.url()).pathname),
    ),
    button.click(),
  ])
  ctx.lastStatus = response.status()
  expect(response.status()).toBe(200)
})

Then('the viewer marks the asset as a favorite', async ({ page }) => {
  await expect(favoriteButton(page).locator('svg.fill-red-500')).toHaveCount(1)
})

Then('the viewer marks the asset as not a favorite', async ({ page }) => {
  await expect(favoriteButton(page)).toBeVisible()
  await expect(favoriteButton(page).locator('svg.fill-red-500')).toHaveCount(0)
})

Then('the favorites page shows the empty state', async ({ page }) => {
  await expect(page.getByText('No favorites yet')).toBeVisible()
})

Then('the favorites grid shows exactly one item', async ({ page }) => {
  await expect(page.locator('figure[role="button"]')).toHaveCount(1, { timeout: 60_000 })
})

Then('the favorites thumbnail image finishes loading', async ({ page }) => {
  await expectThumbnailLoaded(page)
})

Then('the favorites grid groups the asset under the pinned date', async ({ page }) => {
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(PINNED_FAVORITES_DATE))
  await expect(page.getByRole('heading', { level: 2, name: label })).toBeVisible()
})
