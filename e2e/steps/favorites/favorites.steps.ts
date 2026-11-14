import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  Then,
  When,
  authHeaders,
  expectThumbnailLoaded,
  requireAuth,
  requireOtherAuth,
  uploadViaApi,
  type AuthResponse,
  type Ctx,
  type FavoriteList,
} from '../support';

function lastFavoritesList(ctx: Ctx): FavoriteList {
  const last = ctx.listResponses?.at(-1);
  if (!last) throw new Error('list favorites first');
  return last;
}

/** The favorite control lives in the desktop top bar AND the mobile action row (hidden `sm:hidden`). */
const favoriteButton = (page: Page) =>
  page.getByTestId('asset-viewer').locator('button[title="Favorite"]:visible');

// An ancient fixed instant keeps the day-group label in the calendar-format branch ("Jan 2, 2020"),
// stable in any timezone — today/yesterday would flake when a test straddles midnight.
const PINNED_FAVORITES_DATE = '2020-01-02T12:00:00.000Z';

When(
  'the other user uploads {string} via the favorites API',
  async ({ request, ctx }, name: string) => {
    ctx.otherAssetId = await uploadViaApi(request, requireOtherAuth(ctx), name);
  },
);

function patchFavorite(
  request: APIRequestContext,
  auth: AuthResponse,
  assetId: string,
  favorite: boolean,
): Promise<number> {
  return request
    .patch(`/api/v1/assets/${assetId}`, { headers: authHeaders(auth), data: { favorite } })
    .then((response) => response.status());
}

When('I favorite the uploaded asset through the favorites API', async ({ request, ctx }) => {
  if (!ctx.assetId) throw new Error('upload an asset first');
  const status = await patchFavorite(request, requireAuth(ctx), ctx.assetId, true);
  expect(status).toBe(200);
  ctx.favoriteIds = [...(ctx.favoriteIds ?? []), ctx.assetId];
});

When(
  'the other user favorites their uploaded asset through the favorites API',
  async ({ request, ctx }) => {
    const assetId = ctx.otherAssetId;
    if (!assetId) throw new Error('the other user must upload an asset first');
    const status = await patchFavorite(request, requireOtherAuth(ctx), assetId, true);
    expect(status).toBe(200);
  },
);

When(
  'the other user tries to favorite my uploaded asset through the favorites API',
  async ({ request, ctx }) => {
    if (!ctx.assetId) throw new Error('upload an asset first');
    ctx.lastStatus = await patchFavorite(request, requireOtherAuth(ctx), ctx.assetId, true);
  },
);

When(
  'I list my favorites with limit {int} and offset {int}',
  async ({ request, ctx }, limit: number, offset: number) => {
    const response = await request.get(
      `/api/v1/assets?favorite=true&limit=${limit}&offset=${offset}`,
      { headers: authHeaders(requireAuth(ctx)) },
    );
    expect(response.status()).toBe(200);
    ctx.listResponses = [...(ctx.listResponses ?? []), (await response.json()) as FavoriteList];
  },
);

Then(
  'the last favorites list holds {int} of {int} items',
  ({ ctx }, items: number, total: number) => {
    const list = lastFavoritesList(ctx);
    expect(list.items).toHaveLength(items);
    expect(list.total).toBe(total);
  },
);

When('I set the uploaded asset date for favorites grouping', async ({ request, ctx }) => {
  if (!ctx.assetId) throw new Error('upload an asset first');
  const auth = requireAuth(ctx);
  // the metadata worker PATCHes the asset asynchronously — wait for its status to leave
  // 'pending' so the pinned date settles first (it no longer nulls takenAt for EXIF-less
  // files; other metadata fields still land late)
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/assets/${ctx.assetId}`, {
          headers: authHeaders(auth),
        });
        expect(response.status()).toBe(200);
        return ((await response.json()) as { metadataStatus?: string }).metadataStatus;
      },
      { timeout: 60_000 },
    )
    .not.toBe('pending');

  const response = await request.patch(`/api/v1/assets/${ctx.assetId}`, {
    headers: authHeaders(auth),
    data: { takenAt: PINNED_FAVORITES_DATE },
  });
  expect(response.status()).toBe(200);
});

When('I click the favorite control in the viewer', async ({ page, ctx }) => {
  const button = favoriteButton(page);
  await expect(button).toBeVisible();
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        /^\/api\/v1\/assets\/[^/]+$/.test(new URL(r.url()).pathname),
    ),
    button.click(),
  ]);
  ctx.lastStatus = response.status();
  expect(response.status()).toBe(200);
});

Then('the viewer marks the asset as a favorite', async ({ page }) => {
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'true');
});

Then('the viewer marks the asset as not a favorite', async ({ page }) => {
  await expect(favoriteButton(page)).toBeVisible();
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
});

Then('the favorites page shows the empty state', async ({ page }) => {
  await expect(page.getByText('No favorites yet')).toBeVisible();
});

Then('the favorites grid shows exactly one item', async ({ page }) => {
  await expect(page.getByTestId('gallery-item')).toHaveCount(1, { timeout: 60_000 });
});

Then('the favorites thumbnail image finishes loading', async ({ page }) => {
  await expectThumbnailLoaded(page);
});

Then('the favorites grid groups the asset under the pinned date', async ({ page }) => {
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(PINNED_FAVORITES_DATE));
  await expect(page.getByRole('heading', { level: 2, name: label })).toBeVisible();
});
