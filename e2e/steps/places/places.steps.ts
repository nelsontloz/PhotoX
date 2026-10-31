import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  Given,
  Then,
  When,
  authHeaders,
  expectImageLoaded,
  getAsset,
  requireAuth,
  uploadViaApi,
  waitForThumbnails,
  workerHeaders,
  type AuthResponse,
} from '../support';

// Rural base, far from anything else in the suite; the e2e places table is empty, so no scenario
// may assert a resolved city name. Every placed asset sits within ~55 m of it.
const PLACES_BASE = { lat: 45.0, lng: 7.0 };

// Offsets for up to three photos, ~55 m max pairwise: at the deep-linked zoom below they collapse
// into one real markercluster bubble (maxClusterRadius 50 px).
const CLUSTER_OFFSETS = [
  { lat: 0.0004, lng: 0 }, // ~45 m north
  { lat: 0.0002, lng: 0.0002 }, // ~22 m north, ~16 m east
  { lat: 0, lng: 0.0004 }, // ~31 m east
];

// Clustering is disabled at zoom >= 16 (disableClusteringAtZoom) and a bubble click only spiderfies
// at the plugin's max clustering zoom 15 — a fit view of tight points lands near 19, where the
// photos are three separate markers. Loading the map with explicit view params (z=14) is the view
// that actually shows a cluster bubble.
const CLUSTER_ZOOM = 14;

// Distinct fixtures: the same bytes uploaded twice by one user answer 409.
const PHOTO_FIXTURES = ['photo.jpg', 'photo-text.jpg', 'face.jpg'];

const placesPanel = (page: Page) => page.locator('aside[aria-label="Photos in this area"]');
const panelLabel = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? 'photo' : 'photos'}`;

function hasViewParams(url: URL): boolean {
  return ['lat', 'lng', 'z'].every((key) => url.searchParams.get(key) !== null);
}

function viewFromUrl(url: URL): { lat: number; lng: number; z: number } {
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const z = url.searchParams.get('z');
  if (lat === null || lng === null || z === null)
    throw new Error(`no map view parameters in ${url.pathname}${url.search}`);
  return { lat: Number(lat), lng: Number(lng), z: Number(z) };
}

/** Polls until transcode reaches a terminal state (same helper as steps/media/video.steps.ts). */
async function waitForTranscodeStatus(
  request: APIRequestContext,
  auth: AuthResponse,
  id: string,
  status: string,
): Promise<void> {
  const terminal = async () => {
    const current = (await getAsset(request, auth, id)).transcodeStatus;
    return current === 'ready' || current === 'failed' ? current : 'pending';
  };
  await expect.poll(terminal, { timeout: 180_000 }).not.toBe('pending');
  expect(await terminal()).toBe(status);
}

/**
 * Sets GPS coordinates through the metadata API (owner-scoped, synchronous). Waits for the
 * metadata worker to stop writing first — it PATCHes latitude/longitude (null for these EXIF-less
 * fixtures) and would wipe coordinates set while its job is still running.
 */
async function setLocation(
  request: APIRequestContext,
  auth: AuthResponse,
  assetId: string,
  lat: number,
  lng: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/assets/${assetId}`, {
          headers: authHeaders(auth),
        });
        expect(response.status()).toBe(200);
        return ((await response.json()) as { metadataStatus?: string }).metadataStatus;
      },
      { timeout: 60_000 },
    )
    .not.toBe('pending');

  // coordinates are worker-only extraction fields (#156), so placing goes through the
  // act-required worker route scoped to the scenario user
  const response = await request.patch(`/worker/assets/${assetId}/metadata`, {
    headers: workerHeaders(auth.user.id),
    data: { latitude: lat, longitude: lng },
  });
  expect(response.status()).toBe(200);
  const updated = (await response.json()) as {
    latitude?: number | null;
    longitude?: number | null;
  };
  expect(updated.latitude).toBeCloseTo(lat, 6);
  expect(updated.longitude).toBeCloseTo(lng, 6);
}

/** Uploads a fixture, places it at the given coordinates, then waits for the md thumbnail. */
async function uploadPlaced(
  request: APIRequestContext,
  auth: AuthResponse,
  name: string,
  lat: number,
  lng: number,
): Promise<string> {
  const id = await uploadViaApi(request, auth, name);
  await setLocation(request, auth, id, lat, lng);
  await waitForThumbnails(request, auth, id, ['md']);
  return id;
}

Given(
  'I upload {int} photos with nearby locations through the places API',
  async ({ request, ctx }, count: number) => {
    if (count < 1 || count > CLUSTER_OFFSETS.length)
      throw new Error(`register 1-${CLUSTER_OFFSETS.length} offsets for this step`);
    const auth = requireAuth(ctx);
    const ids: string[] = [];
    const coords: { lat: number; lng: number }[] = [];
    for (const offset of CLUSTER_OFFSETS.slice(0, count)) {
      const fixture = PHOTO_FIXTURES[coords.length];
      if (!fixture) throw new Error(`no photo fixture registered for upload #${coords.length + 1}`);
      const location = { lat: PLACES_BASE.lat + offset.lat, lng: PLACES_BASE.lng + offset.lng };
      ids.push(await uploadPlaced(request, auth, fixture, location.lat, location.lng));
      coords.push(location);
    }
    ctx.placesAssetIds = ids;
    ctx.placesCenter = {
      lat: coords.reduce((sum, c) => sum + c.lat, 0) / coords.length,
      lng: coords.reduce((sum, c) => sum + c.lng, 0) / coords.length,
    };
  },
);

Given('I upload a photo with a location through the places API', async ({ request, ctx }) => {
  const auth = requireAuth(ctx);
  const id = await uploadPlaced(request, auth, 'photo.jpg', PLACES_BASE.lat, PLACES_BASE.lng);
  ctx.assetId = id;
  ctx.placesAssetIds = [id];
  ctx.placesCenter = { ...PLACES_BASE };
});

Given(
  'I upload the video fixture with a location through the places API',
  async ({ request, ctx }) => {
    const auth = requireAuth(ctx);
    const id = await uploadPlaced(
      request,
      auth,
      'video-h264.mp4',
      PLACES_BASE.lat,
      PLACES_BASE.lng,
    );
    await waitForTranscodeStatus(request, auth, id, 'ready');
    ctx.assetId = id;
    ctx.placesAssetIds = [id];
    ctx.placesCenter = { ...PLACES_BASE };
  },
);

When('I open the places map over the uploaded photos', async ({ page, ctx }) => {
  const center = ctx.placesCenter;
  if (!center) throw new Error('upload placed photos first');
  await page.goto(`/places?lat=${center.lat}&lng=${center.lng}&z=${CLUSTER_ZOOM}`);
});

Then('the places map shows a cluster bubble with count {int}', async ({ page }, count: number) => {
  const bubble = page.locator('.photox-cluster-bubble');
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toHaveText(String(count));
});

When('I click the cluster bubble', async ({ page, ctx }) => {
  ctx.placesView = viewFromUrl(new URL(page.url()));
  await page.locator('.photox-cluster-bubble').click();
  await expect(placesPanel(page)).toBeVisible();
});

Then('the places panel lists {int} photos', async ({ page }, count: number) => {
  const panel = placesPanel(page);
  await expect(panel.getByRole('heading', { level: 2, name: panelLabel(count) })).toBeVisible();
  await expect(panel.locator('figure[role="button"]')).toHaveCount(count);
});

Then('the places panel lists a single photo', async ({ page }) => {
  const panel = placesPanel(page);
  await expect(panel.getByRole('heading', { level: 2, name: '1 photo' })).toBeVisible();
  await expect(panel.locator('figure[role="button"]')).toHaveCount(1);
});

Then('the map view in the URL is unchanged', ({ page, ctx }) => {
  const before = ctx.placesView;
  if (!before) throw new Error('capture the map view before it is compared');
  const after = viewFromUrl(new URL(page.url()));
  expect(after.z).toBe(before.z);
  expect(after.lat).toBeCloseTo(before.lat, 4);
  expect(after.lng).toBeCloseTo(before.lng, 4);
});

When('I click the first photo in the places panel', async ({ page, ctx }) => {
  await placesPanel(page).locator('figure[role="button"]').first().click();
  await expect(page).toHaveURL(/[?&]asset=/);
  const id = new URL(page.url()).searchParams.get('asset');
  if (!id) throw new Error('no ?asset= id in the URL after opening the places viewer');
  ctx.placesWalkedIds = [id];
});

Then('the viewer is open on a placed photo', async ({ page, ctx }) => {
  await expect(page.locator('div.fixed.inset-0.z-50')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('asset');
  if (!id) throw new Error('no ?asset= id in the URL');
  expect(ctx.placesAssetIds ?? []).toContain(id);
});

When('I go to the next photo in the viewer', async ({ page, ctx }) => {
  const previous = new URL(page.url()).searchParams.get('asset');
  await page.locator('button[aria-label="Next photo"]:visible').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('asset')).not.toBe(previous);
  const id = new URL(page.url()).searchParams.get('asset');
  if (!id) throw new Error('no ?asset= id in the URL after stepping');
  ctx.placesWalkedIds = [...(ctx.placesWalkedIds ?? []), id];
});

Then('the viewer walked every placed photo', ({ ctx }) => {
  const placed = ctx.placesAssetIds ?? [];
  const walked = ctx.placesWalkedIds ?? [];
  expect(new Set(walked).size).toBe(placed.length);
  expect([...walked].sort()).toEqual([...placed].sort());
});

When('I close the places viewer', async ({ page }) => {
  // the top bar renders before the media, so its back button is the overlay's first button
  await page.locator('div.fixed.inset-0.z-50 button').first().click();
  await expect(page.locator('div.fixed.inset-0.z-50')).toHaveCount(0);
});

Then('the places map shows a single location marker', async ({ page }) => {
  const marker = page.locator('.photox-thumb-marker');
  await expect(marker).toHaveCount(1);
  await expectImageLoaded(marker.locator('img'));
});

Then('the URL holds the map view parameters', async ({ page, ctx }) => {
  await expect.poll(() => hasViewParams(new URL(page.url()))).toBe(true);
  ctx.placesView = viewFromUrl(new URL(page.url()));
});

When('I zoom the map out with the Leaflet zoom control', async ({ page }) => {
  await page.locator('.leaflet-control-zoom-out').click();
});

Then('the map view parameters in the URL changed', async ({ page, ctx }) => {
  const before = ctx.placesView;
  if (!before) throw new Error('capture the map view before zooming');
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('z'))).not.toBe(before.z);
  ctx.placesView = viewFromUrl(new URL(page.url()));
  expect(ctx.placesView.z).toBeLessThan(before.z);
});

When('I reload the page', async ({ page }) => {
  await page.reload();
});

Then('the URL still holds the same map view parameters', async ({ page, ctx }) => {
  const before = ctx.placesView;
  if (!before) throw new Error('capture the map view before reloading');
  await expect.poll(() => hasViewParams(new URL(page.url()))).toBe(true);
  const after = viewFromUrl(new URL(page.url()));
  expect(after.z).toBe(before.z);
  expect(after.lat).toBeCloseTo(before.lat, 4);
  expect(after.lng).toBeCloseTo(before.lng, 4);
});

Then('the map fits the placed photo', async ({ page, ctx }) => {
  const center = ctx.placesCenter;
  if (!center) throw new Error('upload a placed photo first');
  await expect.poll(() => hasViewParams(new URL(page.url()))).toBe(true);
  const view = viewFromUrl(new URL(page.url()));
  expect(view.lat).toBeCloseTo(center.lat, 4);
  expect(view.lng).toBeCloseTo(center.lng, 4);
  // a single point has no bounds to fit: the view lands on the OSM layer's maxZoom cap
  expect(view.z).toBe(19);
  await expect(page.locator('.photox-thumb-marker')).toHaveCount(1);
});

When('I click the location marker', async ({ page }) => {
  await page.locator('.photox-thumb-marker').click();
  await expect(placesPanel(page)).toBeVisible();
});

Then('the viewer opens above the map and stays clickable', async ({ page }) => {
  const overlay = page.locator('div.fixed.inset-0.z-50');
  await expect(overlay).toBeVisible();
  // Leaflet panes/controls carry z-index 400-1000; `.places-map`'s `isolation: isolate` confines
  // that band under this z-50 overlay. Without it the map paints through the viewer, and the
  // element at the overlay's center no longer belongs to it.
  await expect
    .poll(() =>
      overlay.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit !== null && el.contains(hit);
      }),
    )
    .toBe(true);
});

Then('the video marker shows a play badge', async ({ page }) => {
  const marker = page.locator('.photox-thumb-marker');
  await expect(marker).toHaveCount(1);
  await expect(marker.locator('.photox-thumb-play')).toBeVisible();
  await expectImageLoaded(marker.locator('img'));
});

Then('the video bubble is selected without a popup', async ({ page }) => {
  await expect(page.locator('.photox-thumb-marker.is-selected')).toHaveCount(1);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});
