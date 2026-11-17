import { expect, type APIRequestContext, type APIResponse, type Response } from '@playwright/test';
import {
  Given,
  Then,
  When,
  addAssetsViaApi,
  authHeaders,
  createAlbumViaApi,
  registerUser,
  requireAssetId,
  requireAuth,
  uploadViaApi,
  type AuthResponse,
  type Ctx,
  type ShareState,
} from '../support';

interface ShareList {
  items: ShareState[];
}

const ALBUM_NAME = 'E2E share album';

function requireShare(share: ShareState | undefined, hint: string): ShareState {
  if (!share) throw new Error(`create a ${hint} share first`);
  return share;
}

const isCreateShareResponse = (response: Response): boolean =>
  response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/shares';

function postShare(
  request: APIRequestContext,
  auth: AuthResponse,
  data: { assetId?: string; albumId?: string },
): Promise<APIResponse> {
  return request.post('/api/v1/shares', { headers: authHeaders(auth), data });
}

async function expectShareCreated(
  response: Pick<APIResponse, 'status' | 'json'>,
): Promise<ShareState> {
  expect(response.status()).toBe(201);
  const share = (await response.json()) as ShareState;
  if (!share.id || !share.token) throw new Error('share response is missing an id or token');
  return share;
}

async function fetchShares(request: APIRequestContext, auth: AuthResponse): Promise<ShareList> {
  const response = await request.get('/api/v1/shares', { headers: authHeaders(auth) });
  expect(response.status()).toBe(200);
  return (await response.json()) as ShareList;
}

/** Registers a fresh user, uploads the fixture and creates the share — no browser session. */
async function seedAssetShare(
  request: APIRequestContext,
  ctx: Ctx,
  kind: 'photo' | 'video',
): Promise<void> {
  const auth = await registerUser(request);
  const fixture = kind === 'video' ? 'video-h264.mp4' : 'photo.jpg';
  const assetId = await uploadViaApi(request, auth, fixture);
  const share = await expectShareCreated(await postShare(request, auth, { assetId }));
  ctx.shareOwner = auth;
  if (kind === 'video') ctx.videoShare = share;
  else ctx.assetShare = share;
  ctx.lastShare = share;
}

async function seedAlbumShare(request: APIRequestContext, ctx: Ctx): Promise<void> {
  const auth = await registerUser(request);
  const assetId = await uploadViaApi(request, auth, 'photo.jpg');
  const album = await createAlbumViaApi(request, auth, ALBUM_NAME);
  expect(await addAssetsViaApi(request, auth, album.id, [assetId])).toBe(201);
  const share = await expectShareCreated(await postShare(request, auth, { albumId: album.id }));
  ctx.shareOwner = auth;
  ctx.albumId = album.id;
  ctx.albumName = ALBUM_NAME;
  ctx.albumMemberId = assetId;
  ctx.albumShare = share;
  ctx.lastShare = share;
  // readiness, not the security rule: the album grid/lightbox sm URLs 404 until the worker
  // renders the thumbnail — wait for the member sm stream here so page loads never race it
  await expect
    .poll(
      async () =>
        (await request.get(`/api/share/${share.token}/assets/${assetId}/content?size=sm`)).status(),
      { timeout: 120_000 },
    )
    .toBe(200);
}

// --- Setup: shares created through the API without a browser session --------------------

Given('a share exists for an uploaded photo', async ({ request, ctx }) => {
  await seedAssetShare(request, ctx, 'photo');
});

Given('a share exists for an uploaded video', async ({ request, ctx }) => {
  await seedAssetShare(request, ctx, 'video');
});

Given('a share exists for an album containing an uploaded photo', async ({ request, ctx }) => {
  await seedAlbumShare(request, ctx);
});

// --- Own shares page: UI ------------------------------------------------------------------

Then('the share list shows the empty state', async ({ page }) => {
  await expect(page.getByText('No shared links yet')).toBeVisible();
  await expect(
    page.getByText('Open a photo or an album and use Share to create a public link.'),
  ).toBeVisible();
});

When('I prepare an album share target with the uploaded photo', async ({ request, ctx }) => {
  const auth = requireAuth(ctx);
  const assetId = requireAssetId(ctx);
  const album = await createAlbumViaApi(request, auth, ALBUM_NAME);
  expect(await addAssetsViaApi(request, auth, album.id, [assetId])).toBe(201);
  ctx.albumId = album.id;
  ctx.albumName = ALBUM_NAME;
});

When('I open the album detail for that share target', async ({ page, ctx }) => {
  const { albumId, albumName } = ctx;
  if (!albumId || !albumName) throw new Error('prepare an album share target first');
  await page.goto(`/albums/${albumId}`);
  await expect(page.getByRole('heading', { level: 1, name: albumName })).toBeVisible();
});

When('I create an album share from the album options', async ({ page, context, ctx }) => {
  // the page writes the link with navigator.clipboard — grant it so "Link copied" can appear
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.bringToFront();
  await page.locator('[aria-label="Album options"]').click();
  const [response] = await Promise.all([
    page.waitForResponse(isCreateShareResponse),
    page.getByRole('button', { name: 'Share album' }).click(),
  ]);
  const share = await expectShareCreated(response);
  ctx.albumShare = share;
  ctx.lastShare = share;
});

Then('the album page confirms the share link was copied', async ({ page }) => {
  await expect(page.getByText('Link copied')).toBeVisible();
});

Then('the shares API lists that share without a usable token', async ({ request, ctx }) => {
  const share = requireShare(ctx.lastShare, 'UI or API');
  const list = await fetchShares(request, requireAuth(ctx));
  const found = list.items.find((item) => item.id === share.id);
  if (!found) throw new Error(`share ${share.id} is not listed by GET /api/v1/shares`);
  // raw capabilities appear only in create responses — the list must not carry one
  expect('token' in found).toBe(false);
});

Then('the share list shows an album share entry', async ({ page }) => {
  await expect(page.getByText('Album', { exact: true })).toBeVisible();
  await expect(page.locator('[title="Revoke share"]')).toHaveCount(1);
});

Then('the share list shows an asset share entry', async ({ page }) => {
  await expect(page.getByText('Photo', { exact: true })).toBeVisible();
  await expect(page.locator('[title="Revoke share"]')).toHaveCount(1);
});

When('I create an asset share from the viewer', async ({ page, ctx }) => {
  const [response] = await Promise.all([
    page.waitForResponse(isCreateShareResponse),
    page.locator('button[title="Share"]:visible').click(),
  ]);
  const share = await expectShareCreated(response);
  if (ctx.assetId && share.assetId !== ctx.assetId) {
    throw new Error('the viewer created a share for a different asset than the open one');
  }
  ctx.assetShare = share;
  ctx.lastShare = share;
});

When('I revoke that share from the share list', async ({ page, ctx }) => {
  const share = requireShare(ctx.lastShare, 'UI or API');
  await page.locator('[title="Revoke share"]').first().click();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Revoke this share link?' }),
  ).toBeVisible();
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' &&
        new URL(r.url()).pathname === `/api/v1/shares/${share.id}`,
    ),
    page.getByRole('button', { name: 'Revoke', exact: true }).click(),
  ]);
  expect(response.status()).toBe(204);
});

Then('the share list no longer lists that share', async ({ page }) => {
  await expect(page.locator('[title="Revoke share"]')).toHaveCount(0);
  await expect(page.getByText('No shared links yet')).toBeVisible();
});

Then('the shares API does not list that share', async ({ request, ctx }) => {
  const share = requireShare(ctx.lastShare, 'UI or API');
  const list = await fetchShares(request, requireAuth(ctx));
  expect(list.items.some((item) => item.id === share.id)).toBe(false);
});

// --- Own shares page: API-level lifecycle -------------------------------------------------

When('I create an asset share for the uploaded photo', async ({ request, ctx }) => {
  const response = await postShare(request, requireAuth(ctx), { assetId: requireAssetId(ctx) });
  ctx.lastStatus = response.status();
  const share = await expectShareCreated(response);
  ctx.assetShare = share;
  ctx.lastShare = share;
});

When('I create an album share for that share target', async ({ request, ctx }) => {
  const albumId = ctx.albumId;
  if (!albumId) throw new Error('prepare an album share target first');
  const share = await expectShareCreated(await postShare(request, requireAuth(ctx), { albumId }));
  ctx.albumShare = share;
  ctx.lastShare = share;
});

When('I trash the uploaded share photo via the API', async ({ request, ctx }) => {
  const response = await request.post(`/api/v1/assets/${requireAssetId(ctx)}/trash`, {
    headers: authHeaders(requireAuth(ctx)),
  });
  expect(response.status()).toBe(204);
});

Then('the share list shows only the album share', async ({ page }) => {
  await expect(page.locator('[title="Revoke share"]')).toHaveCount(1);
  await expect(page.getByText('Album', { exact: true })).toBeVisible();
  await expect(page.getByText('Photo', { exact: true })).toHaveCount(0);
});

// --- Public share pages and APIs (anonymous) ---------------------------------------------

When('an anonymous client calls the public share API for that share', async ({ request, ctx }) => {
  const share = requireShare(ctx.lastShare, 'UI or API');
  ctx.lastStatus = (await request.get(`/api/share/${share.token}`)).status();
});

When('I open the public share page for that share', async ({ page, ctx }) => {
  const share = requireShare(ctx.lastShare, 'UI or API');
  await page.goto(`/share/${share.token}`);
});

Then('the public share page shows the shared photo', async ({ page, ctx }) => {
  const share = requireShare(ctx.lastShare, 'UI or API');
  // the anonymous context must stay on the capability URL, not bounce to /login
  expect(new URL(page.url()).pathname).toBe(`/share/${share.token}`);
  const img = page.locator(`img[src*="/api/share/${share.token}/content"]`);
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
});

Then('the public share page shows the share album header and grid', async ({ page, ctx }) => {
  const albumName = ctx.albumName;
  if (!albumName) throw new Error('seed an album share first');
  await expect(page.getByRole('heading', { level: 1, name: albumName })).toBeVisible();
  const grid = page.locator('main button');
  await expect(grid.first()).toBeVisible();
  expect(await grid.count()).toBeGreaterThanOrEqual(1);
  const img = grid.first().locator('img');
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
});

When('I open the first share album photo', async ({ page }) => {
  await page.locator('main button').first().click();
});

Then('the public share lightbox is open', async ({ page }) => {
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('img')).toBeVisible();
});

Then('the public share lightbox is closed', async ({ page }) => {
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

Then('the public share page plays the shared video', async ({ page }) => {
  const video = page.locator('video[aria-label^="Video player"]');
  // A size container without a definite height collapses the frame to 0x0 — visibility catches it.
  await expect(video).toBeVisible();
  // preload="metadata" stops at readyState 1 until playback starts — metadata + a decodable
  // video track (videoWidth > 0) is the strongest signal short of pressing play
  await expect
    .poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((el) => (el as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
});

Then('the public share page shows not found', async ({ page }) => {
  await expect(page.getByText('Share not found')).toBeVisible();
});

When('that share is revoked through the API', async ({ request, ctx }) => {
  const share = requireShare(ctx.lastShare, 'UI or API');
  const owner = ctx.shareOwner;
  if (!owner) throw new Error('seed a share first');
  const response = await request.delete(`/api/v1/shares/${share.id}`, {
    headers: authHeaders(owner),
  });
  expect(response.status()).toBe(204);
});
