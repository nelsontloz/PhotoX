import { expect, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { Then, When, authHeaders, requireAuth, type AuthResponse, type Ctx } from '../support';

/** Code-matched subsets of the person wire shapes (support.ts has no person types). */
interface PersonSummary {
  id: string;
  name: string | null;
  clusterLabel: string | null;
  coverFaceId: string | null;
  faceCount: number;
}

interface PersonList {
  items: PersonSummary[];
  total: number;
}

function requirePersonId(ctx: Ctx): string {
  const id = ctx.personId;
  if (!id) throw new Error('create a person first (seed faces and cluster)');
  return id;
}

async function fetchPerson(
  request: APIRequestContext,
  auth: AuthResponse,
  id: string,
): Promise<PersonSummary> {
  const response = await request.get(`/api/v1/persons/${id}`, { headers: authHeaders(auth) });
  expect(response.status()).toBe(200);
  return (await response.json()) as PersonSummary;
}

async function fetchPersons(
  request: APIRequestContext,
  auth: AuthResponse,
  query = '',
): Promise<PersonList> {
  const response = await request.get(`/api/v1/persons${query}`, { headers: authHeaders(auth) });
  expect(response.status()).toBe(200);
  return (await response.json()) as PersonList;
}

/** Polls GET /persons until at least `minimum` items match; returns the matches of that fetch. */
async function waitForPersons(
  request: APIRequestContext,
  auth: AuthResponse,
  predicate: (person: PersonSummary) => boolean,
  minimum: number,
): Promise<PersonSummary[]> {
  let matches: PersonSummary[] = [];
  await expect
    .poll(
      async () => {
        const list = await fetchPersons(request, auth);
        matches = list.items.filter(predicate);
        return matches.length;
      },
      { timeout: 60_000, message: 'the cluster job never produced the expected person(s)' },
    )
    .toBeGreaterThanOrEqual(minimum);
  return matches;
}

const isClusterPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/v1/persons/cluster';

const isPersonPatch = (response: Response): boolean =>
  response.request().method() === 'PATCH' &&
  /^\/api\/v1\/persons\/[^/]+$/.test(new URL(response.url()).pathname);

/** Inline-renames through the detail heading and awaits the PATCH. */
async function renamePersonInline(page: Page, name: string): Promise<void> {
  await page.locator('h1[title="Click to rename"]').click();
  await page.locator('main input').first().fill(name);
  const [response] = await Promise.all([
    page.waitForResponse(isPersonPatch),
    page.keyboard.press('Enter'),
  ]);
  expect(response.status()).toBe(200);
}

When('I trigger person clustering through the API', async ({ request, ctx }) => {
  const response = await request.post('/api/v1/persons/cluster', {
    headers: authHeaders(requireAuth(ctx)),
  });
  ctx.lastStatus = response.status();
  expect(response.status()).toBe(202);
  expect(((await response.json()) as { queued?: boolean }).queued).toBe(true);
});

When('I run clustering from the people page', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  const [response] = await Promise.all([
    page.waitForResponse(isClusterPost),
    page.getByRole('button', { name: 'Run clustering' }).click(),
  ]);
  expect(response.status()).toBe(202);
  // transient badge — the page hides it after 3 seconds
  await expect(page.getByText('Clustering queued')).toBeVisible();
});

Then(
  'a person with {int} faces appears through the API',
  async ({ request, ctx }, faceCount: number) => {
    const auth = requireAuth(ctx);
    const persons = await waitForPersons(
      request,
      auth,
      (person) => person.faceCount >= faceCount,
      1,
    );
    ctx.personId = persons[0]!.id;
  },
);

Then(
  'two persons with {int} faces each appear through the API',
  async ({ request, ctx }, faceCount: number) => {
    const auth = requireAuth(ctx);
    const persons = await waitForPersons(
      request,
      auth,
      (person) => person.faceCount >= faceCount,
      2,
    );
    expect(new Set(persons.map((person) => person.id)).size).toBe(2);
  },
);

Then('the people page shows the empty state', async ({ page }) => {
  await expect(page.getByText('No people found')).toBeVisible();
  await expect(page.locator('a[href^="/people/"]')).toHaveCount(0);
});

Then(
  'the people page shows a person card with {int} faces named {string}',
  async ({ page }, faceCount: number, name: string) => {
    // the list only polls for ~30s after the button click — take a fresh snapshot instead
    await page.reload();
    const card = page
      .locator('a[href^="/people/"]')
      .filter({ hasText: `${faceCount} ${faceCount === 1 ? 'face' : 'faces'}` })
      .filter({ hasText: name });
    await expect(card).toHaveCount(1, { timeout: 60_000 });
  },
);

Then('the people page shows a person card named {string}', async ({ page }, name: string) => {
  const card = page.locator('a[href^="/people/"]').filter({ hasText: name });
  await expect(card).toHaveCount(1, { timeout: 60_000 });
});

When('I open the first person card', async ({ page, ctx }) => {
  await page.locator('a[href^="/people/"]').first().click();
  await expect(page).toHaveURL(`/people/${requirePersonId(ctx)}`);
});

When('I rename the person to {string}', async ({ page }, name: string) => {
  await renamePersonInline(page, name);
});

When('I clear the person name in the UI', async ({ page }) => {
  await renamePersonInline(page, '');
});

Then('the person heading shows {string}', async ({ page }, name: string) => {
  await expect(page.locator('main h1').first()).toHaveText(name);
});

When('I reload the person detail page', async ({ page }) => {
  await page.reload();
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 30_000 });
});

When('I go back to the people page', async ({ page }) => {
  // the detail header's back arrow is the first button in the page content
  await page.locator('main button').first().click();
  await expect(page).toHaveURL('/people');
});

Then('the person detail shows one asset without a face box overlay', async ({ page }) => {
  await expect(page.getByTestId('gallery-item')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId('gallery-item').getByTestId('face-box')).toHaveCount(0);
});

Then('the person detail shows a {string} day header', async ({ page }, label: string) => {
  await expect(page.locator('main h2').first()).toHaveText(label, { timeout: 60_000 });
});

Then('the person API name is {string}', async ({ request, ctx }, name: string) => {
  const person = await fetchPerson(request, requireAuth(ctx), requirePersonId(ctx));
  expect(person.name).toBe(name);
});

Then('the person API has no name', async ({ request, ctx }) => {
  const person = await fetchPerson(request, requireAuth(ctx), requirePersonId(ctx));
  expect(person.name).toBeNull();
});
