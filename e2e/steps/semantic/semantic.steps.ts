import { expect, type APIRequestContext } from '@playwright/test';
import {
  Then,
  When,
  authHeaders,
  requireAuth,
  uploadFixture,
  type AuthResponse,
  type Ctx,
  type SemanticUpload,
} from '../support';

interface RelatedAssets {
  items: { id: string }[];
  total: number;
}

function uploadsOf(ctx: Ctx): SemanticUpload[] {
  const uploads = ctx.semanticUploads;
  if (!uploads || uploads.length === 0) {
    throw new Error('upload a photo for semantic processing first');
  }
  return uploads;
}

async function fetchSimilar(
  request: APIRequestContext,
  auth: AuthResponse,
  assetId: string,
): Promise<RelatedAssets> {
  // The HNSW similarity scan is global: fixtures re-uploaded by other scenarios are duplicate
  // vectors in the index and can exhaust the default ef_search window (limit 12 -> ef_search 13)
  // before the per-user filter runs, starving this user's results. A larger limit widens the
  // candidate window so residual test data in the shared DB cannot flip this assertion.
  const response = await request.get(`/api/v1/assets/${assetId}/similar?limit=100`, {
    headers: authHeaders(auth),
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as RelatedAssets;
}

/** `similar` is empty exactly when the source asset has no embedding — B proving A embedded. */
async function expectVisuallySimilar(
  request: APIRequestContext,
  auth: AuthResponse,
  a: string,
  b: string,
): Promise<void> {
  await expect
    .poll(async () => (await fetchSimilar(request, auth, a)).items.some((item) => item.id === b), {
      timeout: 120_000,
      message: 'the uploaded photos never became visually similar — embedding missing or failed',
    })
    .toBe(true);
}

When(
  'I upload {string} for semantic processing',
  async ({ page, ctx, $testInfo }, name: string) => {
    // scenario 4 runs two global reprocess queues; give it room beyond the 120s default
    $testInfo.setTimeout(240_000);
    // 06 uploads photo.jpg as the admin first, so scenario 4 legitimately gets a 200 duplicate
    // pointing at the already-processed asset — the duplicate is fine, only the id matters here
    const assetId = await uploadFixture(page, name, { allowDuplicate: true });
    const uploads = (ctx.semanticUploads ??= []);
    uploads.push({ name, assetId });
    ctx.assetId = assetId;
  },
);

Then('the uploaded photos are visually similar to each other', async ({ request, ctx }) => {
  const auth = requireAuth(ctx);
  const uploads = uploadsOf(ctx);
  const [a, b] = uploads;
  if (!a || !b) throw new Error('upload two photos for semantic processing first');
  await expectVisuallySimilar(request, auth, a.assetId, b.assetId);
});
