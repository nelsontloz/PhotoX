import { randomUUID } from 'node:crypto';
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import {
  Given,
  Then,
  When,
  addAssetsViaApi,
  authHeaders,
  createAlbumViaApi,
  expectThumbnailLoaded,
  requireAuth,
  uploadViaApi,
  waitForThumbnails,
  type AlbumRef,
  type AuthResponse,
  type Ctx,
} from '../support';

interface AlbumAssetsPayload {
  items: { id: string }[];
  total: number;
}

function currentAlbum(ctx: Ctx): AlbumRef {
  const albums = ctx.albums ?? [];
  const [album] = albums;
  if (!album) throw new Error('create an album first');
  // a bare "the album" step in a two-album scenario used to target whichever album was created
  // last, so an ordering swap could pass against the wrong one: name the album instead
  if (albums.length > 1) {
    throw new Error('ambiguous album: pass the album name (e.g. `the album "X"`)');
  }
  return album;
}

function albumAssetAt(ctx: Ctx, index: number): string {
  const assetId = ctx.albumAssets?.[index];
  if (!assetId) throw new Error(`upload album photos first (no photo at index ${index})`);
  return assetId;
}

const isCreateAlbum = (response: Response): boolean =>
  response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/albums';

const isAlbumAssetsPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  /^\/api\/v1\/albums\/[^/]+\/assets$/.test(new URL(response.url()).pathname);

async function fetchAlbumAssets(
  request: APIRequestContext,
  auth: AuthResponse,
  albumId: string,
): Promise<AlbumAssetsPayload> {
  const response = await request.get(`/api/v1/albums/${albumId}/assets?limit=100`, {
    headers: authHeaders(auth),
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as AlbumAssetsPayload;
}

async function findAlbumByName(
  request: APIRequestContext,
  auth: AuthResponse,
  name: string,
): Promise<AlbumRef> {
  const listResponse = await request.get('/api/v1/albums?limit=1000', {
    headers: authHeaders(auth),
  });
  expect(listResponse.status()).toBe(200);
  const list = (await listResponse.json()) as { items: AlbumRef[] };
  const album = list.items.find((candidate) => candidate.name === name);
  if (!album) throw new Error(`album "${name}" was not found via the API`);
  return album;
}

// --- seeding ----------------------------------------------------------------

Given('I created an album via the API named {string}', async ({ request, ctx }, name: string) => {
  const album = await createAlbumViaApi(request, requireAuth(ctx), name);
  const albums = (ctx.albums ??= []);
  albums.push(album);
});

Given('I uploaded an album photo', async ({ request, ctx }) => {
  const assetId = await uploadViaApi(request, requireAuth(ctx), 'photo.jpg');
  ctx.albumAssets = [assetId];
  ctx.assetId = assetId;
});

Given('I uploaded two album photos', async ({ request, ctx }) => {
  const auth = requireAuth(ctx);
  const first = await uploadViaApi(request, auth, 'photo.jpg');
  const second = await uploadViaApi(request, auth, 'photo-text.jpg');
  ctx.albumAssets = [first, second];
  ctx.assetId = first;
});

// --- album API actions ------------------------------------------------------

When('I add my album photo to the album', async ({ request, ctx }) => {
  const status = await addAssetsViaApi(request, requireAuth(ctx), currentAlbum(ctx).id, [
    albumAssetAt(ctx, 0),
  ]);
  ctx.lastStatus = status;
  expect(status).toBe(201);
});

When(
  'I list my albums with limit {int} and offset {int}',
  async ({ request, ctx }, limit: number, offset: number) => {
    const response = await request.get(`/api/v1/albums?limit=${limit}&offset=${offset}`, {
      headers: authHeaders(requireAuth(ctx)),
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { items: AlbumRef[] };
    ctx.albumPage = body.items.map((album) => ({ id: album.id, name: album.name }));
  },
);

// --- album API assertions ---------------------------------------------------

Then('the album asset count is {int}', async ({ request, ctx }, count: number) => {
  const payload = await fetchAlbumAssets(request, requireAuth(ctx), currentAlbum(ctx).id);
  expect(payload.total).toBe(count);
});

Then('my timeline still contains the album photo', async ({ request, ctx }) => {
  const response = await request.get('/api/v1/assets', { headers: authHeaders(requireAuth(ctx)) });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { items: { id: string }[] };
  expect(body.items.map((item) => item.id)).toContain(albumAssetAt(ctx, 0));
});

// --- hidden from timeline ---------------------------------------------------

interface TimelinePayload {
  items: { id: string }[];
  total: number;
}

/** GET /api/v1/assets as the signed-in user, optionally narrowed (e.g. `&albumId=…`). */
async function fetchTimeline(
  request: APIRequestContext,
  auth: AuthResponse,
  query = '',
): Promise<TimelinePayload> {
  const response = await request.get(`/api/v1/assets?limit=100${query}`, {
    headers: authHeaders(auth),
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as TimelinePayload;
}

Then('my timeline does not contain the album photo', async ({ request, ctx }) => {
  const timeline = await fetchTimeline(request, requireAuth(ctx));
  expect(timeline.items.map((item) => item.id)).not.toContain(albumAssetAt(ctx, 0));
});

// --- albums page UI ---------------------------------------------------------

When('I create an album through the UI named {string}', async ({ page, ctx }, name: string) => {
  await page.getByRole('button', { name: 'New Album' }).first().click();
  await page.getByPlaceholder('e.g. Summer 2025').fill(name);
  const [response] = await Promise.all([
    page.waitForResponse(isCreateAlbum),
    page.getByRole('button', { name: 'Create', exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  const album = (await response.json()) as AlbumRef;
  const albums = (ctx.albums ??= []);
  albums.push({ id: album.id, name: album.name });
});

Then('the albums page shows the album card {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
});

When('I open the album card {string}', async ({ page }, name: string) => {
  await page.locator('a[href^="/albums/"]').filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/albums\/[^/?]+/);
});

Then('the albums page lists {int} album cards', async ({ page }, count: number) => {
  await expect(page.locator('a[href^="/albums/"]')).toHaveCount(count);
});

When('I search albums for {string}', async ({ page }, query: string) => {
  await page.getByPlaceholder('Search albums…').fill(query);
});

Then('only the album card {string} is visible', async ({ page }, name: string) => {
  const cards = page.locator('a[href^="/albums/"]');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(name);
});

// --- albums page UI: hidden from timeline via the card menu -----------------

/** Opens an album's menu, clicks the timeline entry, and waits for its PATCH to land. */
async function toggleAlbumTimeline(
  page: Page,
  ctx: Ctx,
  label: string,
  open: Locator,
): Promise<Locator> {
  const album = currentAlbum(ctx);
  await open.click();
  const entry = page.getByRole('button', { name: label });
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === `/api/v1/albums/${album.id}`,
    ),
    entry.click(),
  ]);
  expect(response.status()).toBe(200);
  return entry;
}

function albumCardMenu(page: Page, ctx: Ctx): Locator {
  return page.getByRole('button', { name: `Options for ${currentAlbum(ctx).name}` });
}

When('I hide the album from its card menu', async ({ page, ctx }) => {
  const entry = await toggleAlbumTimeline(
    page,
    ctx,
    'Hide from timeline',
    albumCardMenu(page, ctx),
  );
  await expect(entry).toHaveCount(0);
});

When('I show the album from its card menu', async ({ page, ctx }) => {
  const entry = await toggleAlbumTimeline(page, ctx, 'Show on timeline', albumCardMenu(page, ctx));
  await expect(entry).toHaveCount(0);
});

Then('the album card shows the hidden indicator', async ({ page, ctx }) => {
  const album = currentAlbum(ctx);
  await expect(
    page.locator(`[data-album-card="${album.id}"] [aria-label="Hidden from timeline"]`),
  ).toBeVisible();
});

Then('the album card hides the hidden indicator', async ({ page, ctx }) => {
  const album = currentAlbum(ctx);
  await expect(
    page.locator(`[data-album-card="${album.id}"] [aria-label="Hidden from timeline"]`),
  ).toHaveCount(0);
});

// --- album detail UI --------------------------------------------------------

When('I open the album', async ({ page, ctx }) => {
  const album = currentAlbum(ctx);
  await page.goto(`/albums/${album.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: album.name, exact: true }),
  ).toBeVisible();
});

Then('the album page shows the empty state', async ({ page }) => {
  await expect(page.getByText('No photos in this album yet')).toBeVisible();
});

When('I rename the album to {string}', async ({ page, ctx }, name: string) => {
  const album = currentAlbum(ctx);
  await page.getByRole('heading', { level: 1, name: album.name, exact: true }).click();
  const input = page.getByRole('main').getByRole('textbox');
  await input.fill(name);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === `/api/v1/albums/${album.id}`,
    ),
    input.press('Enter'),
  ]);
  expect(response.status()).toBe(200);
  album.name = name;
});

When('I start renaming the album to {string}', async ({ page, ctx }, name: string) => {
  const album = currentAlbum(ctx);
  await page.getByRole('heading', { level: 1, name: album.name, exact: true }).click();
  await page.getByRole('main').getByRole('textbox').fill(name);
});

When('I cancel the album rename with Escape', async ({ page }) => {
  await page.getByRole('main').getByRole('textbox').press('Escape');
});

Then('the album title is {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
});

When('I reload the album page', async ({ page }) => {
  await page.reload();
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
});

When('I edit the album description to {string}', async ({ page, ctx }, description: string) => {
  const album = currentAlbum(ctx);
  await page.locator('button[aria-label="Album options"]').click();
  page.once('dialog', (dialog) => void dialog.accept(description));
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === `/api/v1/albums/${album.id}`,
    ),
    page.getByRole('button', { name: 'Edit description' }).click(),
  ]);
  expect(response.status()).toBe(200);
});

Then('the album description is {string}', async ({ page }, description: string) => {
  await expect(page.getByText(description, { exact: true })).toBeVisible();
});

When('I delete the album from its options menu', async ({ page }) => {
  await page.locator('button[aria-label="Album options"]').click();
  await page.getByRole('button', { name: 'Delete album' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL('/albums');
});

Then('the albums page shows no album cards', async ({ page }) => {
  await expect(page.getByText('No albums yet')).toBeVisible();
  await expect(page.locator('a[href^="/albums/"]')).toHaveCount(0);
});

When('I open the add photos dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Add photos' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

Then('the add photos dialog lists {int} album photos', async ({ page }, count: number) => {
  await expect(page.getByRole('dialog').getByTestId('gallery-item')).toHaveCount(count);
});

When('I select all album photos in the dialog', async ({ page }) => {
  const figures = page.getByRole('dialog').getByTestId('gallery-item');
  const count = await figures.count();
  if (count === 0) throw new Error('the add photos dialog has no photos to select');
  for (let i = 0; i < count; i++) {
    await figures.nth(i).click();
  }
  await expect(
    page.getByRole('dialog').getByText(`${count} ${count === 1 ? 'photo' : 'photos'} selected`),
  ).toBeVisible();
});

When('I add the selected album photos', async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse(isAlbumAssetsPost),
    page
      .getByRole('dialog')
      .getByRole('button', { name: /^Add \d+$/ })
      .click(),
  ]);
  expect(response.status()).toBe(201);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

Then('the album page shows {int} album photos', async ({ page }, count: number) => {
  await expect(page.getByTestId('gallery-item')).toHaveCount(count);
  await expect(
    page.getByText(`${count} ${count === 1 ? 'item' : 'items'}`, { exact: true }),
  ).toBeVisible();
});

Then('the first album photo thumbnail loads', async ({ page, request, ctx }) => {
  // the album page fetches its assets once; at that point the API-uploaded photos may not have
  // registered thumbnails yet, and AssetThumb only renders an <img> once one exists — so wait
  // server-side for the album's thumbs, then reload so the page picks them up
  const auth = requireAuth(ctx);
  const album = currentAlbum(ctx);
  const payload = await fetchAlbumAssets(request, auth, album.id);
  if (payload.items.length === 0) {
    throw new Error('the album has no photos to load a thumbnail for');
  }
  for (const item of payload.items) {
    await waitForThumbnails(request, auth, item.id, ['md']);
  }
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: album.name, exact: true }),
  ).toBeVisible();
  await expectThumbnailLoaded(page);
});

When('I open the first album photo in the viewer', async ({ page, ctx }) => {
  await page.getByTestId('gallery-item').first().click();
  await expect(page).toHaveURL(/[?&]asset=/);
  const assetId = new URL(page.url()).searchParams.get('asset');
  if (ctx.assetId && assetId !== ctx.assetId) throw new Error('opened the wrong album photo');
  await expect(page.getByTestId('asset-viewer')).toBeVisible();
});

When('I remove the open photo from the album', async ({ page }) => {
  await page.locator('button[aria-label="Remove from this album"]:visible').click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('asset-viewer')).toHaveCount(0);
});

When('I open a missing album page', async ({ page }) => {
  await page.goto(`/albums/${randomUUID()}`);
});

Then('the album page shows the not-found state', async ({ page }) => {
  await expect(page.getByText('Album not found')).toBeVisible();
});

// --- album detail UI: hidden from timeline ----------------------------------

When('I hide the album from its options menu', async ({ page, ctx }) => {
  await toggleAlbumTimeline(
    page,
    ctx,
    'Hide from timeline',
    page.locator('button[aria-label="Album options"]'),
  );
});

Then('the album page shows the hidden badge', async ({ page }) => {
  await expect(page.getByText('Hidden from timeline', { exact: true })).toBeVisible();
});

// --- timeline viewer picker -------------------------------------------------

When('I select the first photo on the timeline', async ({ page }) => {
  const checkbox = page.getByTestId('gallery-item').locator('button[role="checkbox"]').first();
  await checkbox.click();
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
});

When('I open the album picker from the selection bar', async ({ page }) => {
  await page.getByRole('button', { name: 'Add to album', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

When('I select the album {string} in the picker', async ({ page }, name: string) => {
  const tile = page.getByRole('dialog').getByRole('button').filter({ hasText: name });
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
});

When('I add the selected photos to the selected albums', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  const [response] = await Promise.all([
    page.waitForResponse(isAlbumAssetsPost),
    dialog.getByRole('button', { name: /^Add to \d+ album/ }).click(),
  ]);
  expect(response.status()).toBe(201);
  await expect(dialog).toHaveCount(0);
});

When('I open the album picker from the viewer', async ({ page }) => {
  await page.locator('button[aria-label="Add to album"]:visible').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

When('I create an album named {string} in the picker', async ({ page }, name: string) => {
  const dialog = page.getByRole('dialog');
  const createFirst = dialog.getByRole('button', { name: 'Create your first album' });
  if (await createFirst.isVisible()) await createFirst.click();
  else await dialog.getByRole('button', { name: 'New album' }).click();
  await dialog.getByPlaceholder('e.g. Summer 2025').fill(name);
  const [createResponse, addResponse] = await Promise.all([
    page.waitForResponse(isCreateAlbum),
    page.waitForResponse(isAlbumAssetsPost),
    dialog.getByRole('button', { name: 'Create', exact: true }).click(),
  ]);
  expect(createResponse.status()).toBe(201);
  expect(addResponse.status()).toBe(201);
  await expect(dialog).toHaveCount(0);
});

Then('the open photo is in the album {string}', async ({ request, ctx }, name: string) => {
  const auth = requireAuth(ctx);
  const assetId = ctx.assetId;
  if (!assetId) throw new Error('open a photo first');
  const album = await findAlbumByName(request, auth, name);
  const payload = await fetchAlbumAssets(request, auth, album.id);
  expect(payload.items.map((item) => item.id)).toContain(assetId);
});

Then(
  'the album {string} contains exactly my album photos',
  async ({ request, ctx }, name: string) => {
    const auth = requireAuth(ctx);
    const assetIds = ctx.albumAssets;
    if (!assetIds?.length) throw new Error('upload album photos first');
    const album = await findAlbumByName(request, auth, name);
    const payload = await fetchAlbumAssets(request, auth, album.id);
    expect(payload.items.map((item) => item.id).sort()).toEqual([...assetIds].sort());
  },
);
