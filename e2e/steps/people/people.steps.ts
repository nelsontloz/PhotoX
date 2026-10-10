import { expect, type APIRequestContext, type Page, type Response } from '@playwright/test'
import {
  Given,
  Then,
  When,
  authHeaders,
  registerUser,
  requireAssetId,
  requireAuth,
  seedEmbedding,
  type AuthResponse,
  type Ctx,
} from '../support'

/** Code-matched subsets of the person wire shapes (support.ts has no person types). */
interface PersonSummary {
  id: string
  name: string | null
  clusterLabel: string | null
  coverFaceId: string | null
  faceCount: number
}

interface PersonList {
  items: PersonSummary[]
  total: number
  limit: number
  offset: number
}

interface FaceSummary {
  id: string
  personId?: string | null
}

function requirePersonId(ctx: Ctx): string {
  const id = ctx.personId
  if (!id) throw new Error('create a person first (seed faces and cluster)')
  return id
}

function requirePersonFaceId(ctx: Ctx): string {
  const id = ctx.personFaceId
  if (!id) throw new Error('seed a person face first')
  return id
}

interface SeedPersonFace {
  box: { x: number; y: number; w: number; h: number }
  embedding: number[]
}

/** Appends faces via the authenticated user endpoint (same wire shape as faces.steps.ts). */
async function seedPersonFaces(
  request: APIRequestContext,
  auth: AuthResponse,
  assetId: string,
  faces: SeedPersonFace[],
): Promise<void> {
  const response = await request.post(`/api/v1/assets/${assetId}/faces`, {
    headers: authHeaders(auth),
    data: {
      detector: 'human',
      faces: faces.map((face) => ({ ...face, confidence: 0.9 })),
    },
  })
  expect(response.status()).toBe(201)
  expect(((await response.json()) as { count: number }).count).toBe(faces.length)
}

async function fetchAssetFaces(
  request: APIRequestContext,
  auth: AuthResponse,
  assetId: string,
): Promise<FaceSummary[]> {
  const response = await request.get(`/api/v1/assets/${assetId}`, { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as { faces?: FaceSummary[] }).faces ?? []
}

async function fetchPerson(
  request: APIRequestContext,
  auth: AuthResponse,
  id: string,
): Promise<PersonSummary> {
  const response = await request.get(`/api/v1/persons/${id}`, { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as PersonSummary
}

async function fetchPersons(
  request: APIRequestContext,
  auth: AuthResponse,
  query = '',
): Promise<PersonList> {
  const response = await request.get(`/api/v1/persons${query}`, { headers: authHeaders(auth) })
  expect(response.status()).toBe(200)
  return (await response.json()) as PersonList
}

/** Polls GET /persons until at least `minimum` items match; returns the matches of that fetch. */
async function waitForPersons(
  request: APIRequestContext,
  auth: AuthResponse,
  predicate: (person: PersonSummary) => boolean,
  minimum: number,
): Promise<PersonSummary[]> {
  let matches: PersonSummary[] = []
  await expect
    .poll(
      async () => {
        const list = await fetchPersons(request, auth)
        matches = list.items.filter(predicate)
        return matches.length
      },
      { timeout: 60_000, message: 'the cluster job never produced the expected person(s)' },
    )
    .toBeGreaterThanOrEqual(minimum)
  return matches
}

async function ensureOtherUser(request: APIRequestContext, ctx: Ctx): Promise<AuthResponse> {
  const other = ctx.otherUser ?? (await registerUser(request))
  ctx.otherUser = other
  return other
}

const isClusterPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/v1/persons/cluster'

const isPersonPatch = (response: Response): boolean =>
  response.request().method() === 'PATCH' &&
  /^\/api\/v1\/persons\/[^/]+$/.test(new URL(response.url()).pathname)

function isFacePersonPatch(faceId: string, response: Response): boolean {
  return (
    response.request().method() === 'PATCH' &&
    new URL(response.url()).pathname === `/api/v1/faces/${faceId}/person`
  )
}

/** Inline-renames through the detail heading and awaits the PATCH. */
async function renamePersonInline(page: Page, name: string): Promise<void> {
  await page.locator('h1[title="Click to rename"]').click()
  await page.locator('main input').first().fill(name)
  const [response] = await Promise.all([
    page.waitForResponse(isPersonPatch),
    page.keyboard.press('Enter'),
  ])
  expect(response.status()).toBe(200)
}

Given('I seed one unassigned person face on my latest photo', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const assetId = requireAssetId(ctx)
  const before = await fetchAssetFaces(request, auth, assetId)
  await seedPersonFaces(request, auth, assetId, [
    { box: { x: 20, y: 20, w: 60, h: 60 }, embedding: seedEmbedding(1) },
  ])
  const added = (await fetchAssetFaces(request, auth, assetId)).filter(
    (face) => !before.some((previous) => previous.id === face.id),
  )
  expect(added.length).toBe(1)
  ctx.personFaceId = added[0]!.id
})

Given('I seed two distinct person clusters on my latest photo', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const assetId = requireAssetId(ctx)
  // two identical-embedding pairs, far apart in vector space -> two DBSCAN clusters -> two persons
  await seedPersonFaces(request, auth, assetId, [
    { box: { x: 10, y: 10, w: 60, h: 60 }, embedding: seedEmbedding(0) },
    { box: { x: 80, y: 10, w: 60, h: 60 }, embedding: seedEmbedding(0) },
    { box: { x: 10, y: 80, w: 60, h: 60 }, embedding: seedEmbedding(1) },
    { box: { x: 80, y: 80, w: 60, h: 60 }, embedding: seedEmbedding(1) },
  ])
})

When('I trigger person clustering through the API', async ({ request, ctx }) => {
  const response = await request.post('/api/v1/persons/cluster', {
    headers: authHeaders(requireAuth(ctx)),
  })
  ctx.lastStatus = response.status()
  expect(response.status()).toBe(202)
  expect(((await response.json()) as { queued?: boolean }).queued).toBe(true)
})

When('I run clustering from the people page', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible()
  const [response] = await Promise.all([
    page.waitForResponse(isClusterPost),
    page.getByRole('button', { name: 'Run clustering' }).click(),
  ])
  expect(response.status()).toBe(202)
  // transient badge — the page hides it after 3 seconds
  await expect(page.getByText('Clustering queued')).toBeVisible()
})

Then(
  'a person with {int} faces appears through the API',
  async ({ request, ctx }, faceCount: number) => {
    const auth = requireAuth(ctx)
    const persons = await waitForPersons(
      request,
      auth,
      (person) => person.faceCount >= faceCount,
      1,
    )
    ctx.personId = persons[0]!.id
  },
)

Then(
  'two persons with {int} faces each appear through the API',
  async ({ request, ctx }, faceCount: number) => {
    const auth = requireAuth(ctx)
    const persons = await waitForPersons(
      request,
      auth,
      (person) => person.faceCount >= faceCount,
      2,
    )
    expect(new Set(persons.map((person) => person.id)).size).toBe(2)
  },
)

Then('the people page shows the empty state', async ({ page }) => {
  await expect(page.getByText('No people found')).toBeVisible()
  await expect(page.locator('a[href^="/people/"]')).toHaveCount(0)
})

Then(
  'the people page shows a person card with {int} faces named {string}',
  async ({ page }, faceCount: number, name: string) => {
    // the list only polls for ~30s after the button click — take a fresh snapshot instead
    await page.reload()
    const card = page
      .locator('a[href^="/people/"]')
      .filter({ hasText: `${faceCount} ${faceCount === 1 ? 'face' : 'faces'}` })
      .filter({ hasText: name })
    await expect(card).toHaveCount(1, { timeout: 60_000 })
  },
)

Then('the people page shows a person card named {string}', async ({ page }, name: string) => {
  const card = page.locator('a[href^="/people/"]').filter({ hasText: name })
  await expect(card).toHaveCount(1, { timeout: 60_000 })
})

When('I open the first person card', async ({ page, ctx }) => {
  await page.locator('a[href^="/people/"]').first().click()
  await expect(page).toHaveURL(`/people/${requirePersonId(ctx)}`)
})

When('I rename the person to {string}', async ({ page }, name: string) => {
  await renamePersonInline(page, name)
})

When('I clear the person name in the UI', async ({ page }) => {
  await renamePersonInline(page, '')
})

Then('the person heading shows {string}', async ({ page }, name: string) => {
  await expect(page.locator('main h1').first()).toHaveText(name)
})

When('I reload the person detail page', async ({ page }) => {
  await page.reload()
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 30_000 })
})

When('I go back to the people page', async ({ page }) => {
  // the detail header's back arrow is the first button in the page content
  await page.locator('main button').first().click()
  await expect(page).toHaveURL('/people')
})

Then('the person detail shows one asset with a face box overlay', async ({ page }) => {
  await expect(page.locator('figure[role="button"]')).toHaveCount(1, { timeout: 60_000 })
  // FaceOverlay.tsx renders one .border-2 box per face inside the figure
  const overlay = page.locator('figure[role="button"] div.border-2')
  await expect(overlay).toHaveCount(1)
  await expect(overlay).toBeVisible()
})

When('I open my latest person photo in the viewer', async ({ page, ctx }) => {
  await page.goto(`/?asset=${requireAssetId(ctx)}`)
  await expect(page.locator('div.fixed.inset-0.z-50')).toBeVisible({ timeout: 30_000 })
})

When('I open the person info panel', async ({ page }) => {
  await page.locator('button[title="Toggle Info"]').click()
  // AssetMetadataPanel also renders an h4 "Details" — anchor the panel header by level + container
  const panel = page.locator('div.fixed.inset-0.z-50 aside')
  await expect(panel.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible()
})

When('I assign the viewer face to the seeded person', async ({ page, ctx }) => {
  const personId = requirePersonId(ctx)
  const faceId = requirePersonFaceId(ctx)
  const select = page.locator('div.fixed.inset-0.z-50 aside select')
  await expect(select.locator(`option[value="${personId}"]`)).toHaveCount(1, { timeout: 30_000 })
  const [response] = await Promise.all([
    page.waitForResponse((response) => isFacePersonPatch(faceId, response)),
    select.selectOption(personId),
  ])
  expect(response.status()).toBe(200)
})

Then('the seeded person face is assigned to the person', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const personId = requirePersonId(ctx)
  const faceId = requirePersonFaceId(ctx)
  const assetId = requireAssetId(ctx)
  await expect
    .poll(
      async () =>
        (await fetchAssetFaces(request, auth, assetId)).find((face) => face.id === faceId)
          ?.personId ?? null,
      { timeout: 30_000 },
    )
    .toBe(personId)
  expect((await fetchPerson(request, auth, personId)).faceCount).toBe(3)
})

When('I unassign the viewer face from the person', async ({ page, ctx }) => {
  const faceId = requirePersonFaceId(ctx)
  const select = page.locator('div.fixed.inset-0.z-50 aside select')
  const [response] = await Promise.all([
    page.waitForResponse((response) => isFacePersonPatch(faceId, response)),
    select.selectOption(''),
  ])
  expect(response.status()).toBe(200)
})

Then('the seeded person face is unassigned from the person', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const personId = requirePersonId(ctx)
  const faceId = requirePersonFaceId(ctx)
  const assetId = requireAssetId(ctx)
  await expect
    .poll(
      async () =>
        (await fetchAssetFaces(request, auth, assetId)).find((face) => face.id === faceId)
          ?.personId ?? null,
      { timeout: 30_000 },
    )
    .toBeNull()
  expect((await fetchPerson(request, auth, personId)).faceCount).toBe(2)
})

Then('another user cannot get the person', async ({ request, ctx }) => {
  const other = await ensureOtherUser(request, ctx)
  const response = await request.get(`/api/v1/persons/${requirePersonId(ctx)}`, {
    headers: authHeaders(other),
  })
  expect(response.status()).toBe(404)
})

Then('another user cannot rename the person', async ({ request, ctx }) => {
  const other = await ensureOtherUser(request, ctx)
  const response = await request.patch(`/api/v1/persons/${requirePersonId(ctx)}`, {
    headers: authHeaders(other),
    data: { name: 'Mallory' },
  })
  expect(response.status()).toBe(404)
})

When('I rename the person to {string} through the API', async ({ request, ctx }, name: string) => {
  const response = await request.patch(`/api/v1/persons/${requirePersonId(ctx)}`, {
    headers: authHeaders(requireAuth(ctx)),
    data: { name },
  })
  expect(response.status()).toBe(200)
  expect(((await response.json()) as PersonSummary).name).toBe(name)
})

Then('the person is named {string} through the API', async ({ request, ctx }, name: string) => {
  const person = await fetchPerson(request, requireAuth(ctx), requirePersonId(ctx))
  expect(person.name).toBe(name)
})

When('I clear the person name through the API', async ({ request, ctx }) => {
  const response = await request.patch(`/api/v1/persons/${requirePersonId(ctx)}`, {
    headers: authHeaders(requireAuth(ctx)),
    data: { name: null },
  })
  expect(response.status()).toBe(200)
  expect(((await response.json()) as PersonSummary).name).toBeNull()
})

Then('the person has no name through the API', async ({ request, ctx }) => {
  const person = await fetchPerson(request, requireAuth(ctx), requirePersonId(ctx))
  expect(person.name).toBeNull()
})

Then('the person API name is {string}', async ({ request, ctx }, name: string) => {
  const person = await fetchPerson(request, requireAuth(ctx), requirePersonId(ctx))
  expect(person.name).toBe(name)
})

Then('the person API has no name', async ({ request, ctx }) => {
  const person = await fetchPerson(request, requireAuth(ctx), requirePersonId(ctx))
  expect(person.name).toBeNull()
})

Then('the person list pages with a limit of {int}', async ({ request, ctx }, limit: number) => {
  const auth = requireAuth(ctx)
  const first = await fetchPersons(request, auth, `?limit=${limit}`)
  expect(first.limit).toBe(limit)
  expect(first.total).toBe(2)
  expect(first.items).toHaveLength(limit)
  const second = await fetchPersons(request, auth, `?limit=${limit}&offset=${limit}`)
  expect(second.offset).toBe(limit)
  expect(second.items).toHaveLength(limit)
  const firstId = first.items[0]?.id
  const secondId = second.items[0]?.id
  if (!firstId || !secondId) throw new Error('person pages did not return items')
  expect(secondId).not.toBe(firstId)
  const beyond = await fetchPersons(request, auth, `?limit=${limit}&offset=${limit * 2}`)
  expect(beyond.items).toHaveLength(0)
})
