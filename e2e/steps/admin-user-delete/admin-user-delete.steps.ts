import { createHmac } from 'node:crypto'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  Given,
  Then,
  When,
  PASSWORD,
  addAssetsViaApi,
  authHeaders,
  createAlbumViaApi,
  getAsset,
  injectSession,
  registerUser,
  seedEmbedding,
  signInAdmin,
  uploadViaApi,
  waitForThumbnails,
  workerHeaders,
  type AuthResponse,
  type Ctx,
} from '../support'

// The suite mints its own tokens with node:crypto (same precedent as workerHeaders in
// support.ts). Open registration only ever mints role 'user' and there is no promote
// endpoint, so the last-admin 409 (target admin != requester, single admin in the DB) is
// unreachable with real sessions — this forges the admin role onto a REAL registered user
// row (the guard's session floor still finds the row) purely to exercise the real server
// guard chain end to end. Test seeding only, never prod.
const E2E_AUTH_TOKEN_SECRET =
  process.env.E2E_AUTH_TOKEN_SECRET ?? 'dev-auth-secret-32-characters-minimum!!'

function base64url(input: string | Buffer): string {
  return (typeof input === 'string' ? Buffer.from(input) : input).toString('base64url')
}

function forgedAdminHeaders(userId: string, email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000)
  const encoded =
    `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.` +
    `${base64url(JSON.stringify({ sub: userId, email, role: 'admin', iat: now, exp: now + 300 }))}`
  const signature = base64url(createHmac('sha256', E2E_AUTH_TOKEN_SECRET).update(encoded).digest())
  return { Authorization: `Bearer ${encoded}.${signature}` }
}

/** Per-scenario deletion state, keyed by the scenario ctx (support.ts Ctx untouched). */
interface UserDeleteState {
  admin?: AuthResponse
  listed?: AuthResponse
  victim?: AuthResponse
  victimAssetId?: string
  victimFileId?: string
  victimAlbumId?: string
  victimShareToken?: string
  victimPersonId?: string
  victimBackupAt?: string
  victimBackupAssets?: number
  sibling?: AuthResponse
  siblingAlbumId?: string
  siblingShareToken?: string
  siblingPersonId?: string
  siblingBackupAt?: string
  reregistered?: AuthResponse
  restoreStatus?: number
  restoredEmail?: string
  lastAdminStatus?: number
  lastAdminMessage?: string
}

const states = new WeakMap<Ctx, UserDeleteState>()

function deleteState(ctx: Ctx): UserDeleteState {
  let state = states.get(ctx)
  if (!state) {
    state = {}
    states.set(ctx, state)
  }
  return state
}

function requireStateAdmin(ctx: Ctx): AuthResponse {
  const admin = deleteState(ctx).admin
  if (!admin) throw new Error('sign in as the seeded administrator first')
  return admin
}

function requireListed(ctx: Ctx): AuthResponse {
  const listed = deleteState(ctx).listed
  if (!listed) throw new Error('register the listed user first')
  return listed
}

function requireVictim(ctx: Ctx): AuthResponse {
  const victim = deleteState(ctx).victim
  if (!victim) throw new Error('register the deletion victim first')
  return victim
}

function requireSibling(ctx: Ctx): AuthResponse {
  const sibling = deleteState(ctx).sibling
  if (!sibling) throw new Error('register the sibling user first')
  return sibling
}

async function requireAdmin(request: APIRequestContext, ctx: Ctx): Promise<AuthResponse> {
  const state = deleteState(ctx)
  state.admin ??= await signInAdmin(request)
  return state.admin
}

interface FullLibrary {
  assetId: string
  fileId: string
  albumId: string
  shareToken: string
  personId: string
  backupAt: string
  backupAssets: number
}

/**
 * Seeds a complete deletable library: one photo, one album holding it, one asset share,
 * one clustered person (two identical-embedding faces), then an S3 backup capturing the
 * counts the exclusion asserts compare against after deletion.
 */
async function seedFullLibrary(
  request: APIRequestContext,
  admin: AuthResponse,
  user: AuthResponse,
  fixture: 'photo.jpg' | 'photo-text.jpg',
): Promise<FullLibrary> {
  const assetId = await uploadViaApi(request, user, fixture)
  const asset = await getAsset(request, user, assetId)
  // the upload enqueues a real detection job that DELETEs + re-detects faces — wait for it
  // to settle BEFORE seeding, or it wipes the seeded faces mid-scenario (same probe pattern
  // as the faces steps)
  await expect
    .poll(
      async () => {
        const settled = await getAsset(request, user, assetId)
        if (settled.faceStatus === 'failed') {
          throw new Error(`face detection failed on asset ${assetId}`)
        }
        return settled.faceStatus ?? 'missing'
      },
      { timeout: 120_000 },
    )
    .toBe('ready')
  const album = await createAlbumViaApi(request, user, 'E2E delete album')
  expect(await addAssetsViaApi(request, user, album.id, [assetId])).toBe(201)
  const shareResponse = await request.post('/api/v1/shares', {
    headers: authHeaders(user),
    data: { assetId },
  })
  expect(shareResponse.status()).toBe(201)
  const share = (await shareResponse.json()) as { token?: string }
  if (!share.token) throw new Error('share response is missing a token')
  const facesResponse = await request.post(`/worker/assets/${assetId}/faces`, {
    headers: workerHeaders(user.user.id),
    data: {
      faces: [
        { box: { x: 10, y: 10, w: 60, h: 60 }, confidence: 0.9, embedding: seedEmbedding(0) },
        { box: { x: 80, y: 10, w: 60, h: 60 }, confidence: 0.9, embedding: seedEmbedding(0) },
      ],
    },
  })
  expect(facesResponse.status()).toBe(201)
  expect(((await facesResponse.json()) as { count: number }).count).toBe(2)
  const clusterResponse = await request.post('/api/v1/persons/cluster', {
    headers: authHeaders(user),
  })
  expect(clusterResponse.status()).toBe(202)
  let personId = ''
  await expect
    .poll(
      async () => {
        const listResponse = await request.get('/api/v1/persons', { headers: authHeaders(user) })
        if (listResponse.status() !== 200) return 0
        const body = (await listResponse.json()) as { items?: { id: string; faceCount: number }[] }
        const found = (body.items ?? []).find((person) => person.faceCount >= 2)
        if (found) personId = found.id
        return found ? found.faceCount : 0
      },
      { timeout: 120_000 },
    )
    .toBeGreaterThanOrEqual(2)
  if (!personId) throw new Error('the cluster job never produced a person')
  const backupResponse = await request.post('/api/v1/admin/backups', {
    headers: authHeaders(admin),
    data: { emailOrId: user.user.id },
  })
  expect(backupResponse.status()).toBe(200)
  const backup = (await backupResponse.json()) as { backedUpAt: string; assets: number }
  return {
    assetId,
    fileId: asset.fileId,
    albumId: album.id,
    shareToken: share.token,
    personId,
    backupAt: backup.backedUpAt,
    backupAssets: backup.assets,
  }
}

/** Narrows the users table to one row and waits for the search-scoped footer to settle. */
async function searchUsersFor(page: Page, email: string): Promise<void> {
  await page.getByLabel('Search users').fill(email)
  await expect(page.getByText('Showing 1 registered user(s)', { exact: true })).toBeVisible({
    timeout: 15_000,
  })
}

function deleteDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Delete user confirmation' })
}

async function openDeleteDialog(page: Page, displayName: string) {
  await page.getByRole('button', { name: `Delete ${displayName}`, exact: true }).click()
  const dialog = deleteDialog(page)
  await expect(dialog).toBeVisible()
  return dialog
}

Given('I am signed in as the seeded administrator', async ({ request, page, baseURL, ctx }) => {
  const admin = await requireAdmin(request, ctx)
  ctx.auth = admin
  await injectSession(page, admin, baseURL)
  await page.goto('/')
})

Given('a regular user is registered for the admin list', async ({ request, ctx }) => {
  deleteState(ctx).listed = await registerUser(request)
})

Given('a regular user with one photo is registered for deletion', async ({ request, ctx }) => {
  const victim = await registerUser(request)
  deleteState(ctx).victim = victim
  await uploadViaApi(request, victim, 'photo.jpg')
})

Given(
  'a victim user with a full library and backup is registered',
  async ({ request, ctx, $testInfo }) => {
    // two full libraries + two inline S3 backups + two cluster runs — allow room past 120s
    $testInfo.setTimeout(360_000)
    const admin = await requireAdmin(request, ctx)
    const victim = await registerUser(request)
    const state = deleteState(ctx)
    state.victim = victim
    const library = await seedFullLibrary(request, admin, victim, 'photo.jpg')
    state.victimAssetId = library.assetId
    state.victimFileId = library.fileId
    state.victimAlbumId = library.albumId
    state.victimShareToken = library.shareToken
    state.victimPersonId = library.personId
    state.victimBackupAt = library.backupAt
    state.victimBackupAssets = library.backupAssets
  },
)

Given('a sibling user with a full library and backup is registered', async ({ request, ctx }) => {
  const admin = await requireAdmin(request, ctx)
  const sibling = await registerUser(request)
  const state = deleteState(ctx)
  state.sibling = sibling
  // a different fixture from the victim's so a shared checksum can never alias the two
  const library = await seedFullLibrary(request, admin, sibling, 'photo-text.jpg')
  state.siblingAlbumId = library.albumId
  state.siblingShareToken = library.shareToken
  state.siblingPersonId = library.personId
  state.siblingBackupAt = library.backupAt
})

Then(
  'the users table shows an Actions column with a Delete button for the listed user',
  async ({ page, ctx }) => {
    const listed = requireListed(ctx)
    await searchUsersFor(page, listed.user.email)
    await expect(page.getByText('Actions', { exact: true })).toBeVisible()
    const remove = page.getByRole('button', {
      name: `Delete ${listed.user.displayName}`,
      exact: true,
    })
    await expect(remove).toHaveCount(1)
    await expect(remove).toBeEnabled()
    expect(await remove.getAttribute('title')).toBe(`Delete ${listed.user.displayName}`)
  },
)

Then('my own admin row disables Delete with the self-delete guard', async ({ page, ctx }) => {
  const admin = requireStateAdmin(ctx)
  await searchUsersFor(page, admin.user.email)
  const remove = page.getByRole('button', {
    name: `Delete ${admin.user.displayName}`,
    exact: true,
  })
  await expect(remove).toHaveCount(1)
  await expect(remove).toBeDisabled()
  expect(await remove.getAttribute('title')).toBe("You can't delete your own account.")
})

When('I open the delete dialog for that user', async ({ page, ctx }) => {
  const victim = requireVictim(ctx)
  await searchUsersFor(page, victim.user.email)
  await openDeleteDialog(page, victim.user.displayName)
})

Then(
  'the delete dialog shows the identity card, impact counts and the backup-kept note',
  async ({ page, ctx }) => {
    const victim = requireVictim(ctx)
    const dialog = deleteDialog(page)
    // the dialog title carries the name too, so the identity card is pinned by the email
    await expect(
      dialog.getByRole('heading', { name: `Delete ${victim.user.displayName}?` }),
    ).toBeVisible()
    await expect(dialog.getByText(victim.user.email)).toBeVisible()
    // no backend preview endpoint exists — the client falls back to generic wording
    await expect(
      dialog.getByText('Their photos, videos, albums and shares will be permanently removed.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(dialog.getByText(/S3 backup is kept/)).toBeVisible()
    await expect(dialog.locator('#delete-user-confirm')).toBeVisible()
  },
)

Then('the delete confirm stays disabled until DELETE is typed exactly', async ({ page }) => {
  const dialog = deleteDialog(page)
  const input = dialog.locator('#delete-user-confirm')
  const confirm = dialog.getByRole('button', { name: 'Delete user', exact: true })
  await expect(confirm).toBeDisabled()
  await input.fill('delete')
  await expect(confirm).toBeDisabled()
  await input.fill(' DELETE ')
  await expect(confirm).toBeDisabled()
  await input.fill('DELETE')
  await expect(confirm).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
})

When('I search the users list for that user', async ({ page, ctx }) => {
  await searchUsersFor(page, requireVictim(ctx).user.email)
})

Then('the users footer shows a single registered user', async ({ page }) => {
  await expect(page.getByText('Showing 1 registered user(s)', { exact: true })).toBeVisible()
})

When(
  'I confirm deletion of that user while the delete response is delayed',
  async ({ page, ctx }) => {
    const victim = requireVictim(ctx)
    const name = victim.user.displayName
    // hold the DELETE (but not the preview GET or status polls) so the working state is
    // observable instead of flashing past before the asserts run
    await page.route('**/api/v1/admin/users/**', async (route) => {
      if (route.request().method() === 'DELETE') {
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      await route.continue()
    })
    try {
      const dialog = await openDeleteDialog(page, name)
      await dialog.locator('#delete-user-confirm').fill('DELETE')
      await dialog.getByRole('button', { name: 'Delete user', exact: true }).click()
      await expect(dialog.getByRole('status')).toContainText(/Removing user/)
      await expect(dialog.getByRole('button', { name: 'Deleting…', exact: true })).toBeDisabled()
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled()
      // Escape and the overlay both stay dead while the removal is in flight
      await page.keyboard.press('Escape')
      await expect(dialog).toBeVisible()
      await page.mouse.click(8, 8)
      await expect(dialog).toBeVisible()
      await expect(page.getByText(`Deleted ${name}.`, { exact: true })).toBeVisible({
        timeout: 120_000,
      })
    } finally {
      await page.unroute('**/api/v1/admin/users/**')
    }
  },
)

Then('the delete dialog is closed', async ({ page }) => {
  await expect(deleteDialog(page)).toHaveCount(0)
})

Then('the users list no longer matches the deleted user', async ({ page, ctx }) => {
  const victim = requireVictim(ctx)
  await expect(
    page.getByRole('button', { name: `Delete ${victim.user.displayName}`, exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText('No users match the current filters.', { exact: true })).toBeVisible()
})

When('that user is removed through the API while the dialog is open', async ({ request, ctx }) => {
  const admin = requireStateAdmin(ctx)
  const victim = requireVictim(ctx)
  // the dialog stays open on the users tab while the account disappears underneath it
  const response = await request.delete(`/api/v1/admin/users/${victim.user.id}`, {
    headers: authHeaders(admin),
  })
  expect(response.status()).toBe(202)
  await expect
    .poll(
      async () => {
        const status = await request.get(`/api/v1/admin/users/${victim.user.id}/delete-status`, {
          headers: authHeaders(admin),
        })
        if (status.status() !== 200) return `http-${status.status()}`
        return ((await status.json()) as { state?: string }).state ?? 'missing'
      },
      { timeout: 120_000 },
    )
    .toBe('completed')
})

When('I confirm deletion of that user', async ({ page }) => {
  const dialog = deleteDialog(page)
  await dialog.locator('#delete-user-confirm').fill('DELETE')
  await dialog.getByRole('button', { name: 'Delete user', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30_000 })
})

Then('the missing-user message is shown and the dialog stays open', async ({ page }) => {
  // the raced delete answers 404, which the dialog maps to the fixed missing-user sentence
  // (403/409 verbatim mapping is covered at the API level below plus the web unit specs)
  const dialog = deleteDialog(page)
  await expect(dialog.getByRole('alert')).toContainText(
    'That user no longer exists. Close this and refresh the list.',
  )
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  // the account is really gone from the list — the external API removal cannot refresh
  // the table by itself (same debounced query), so re-sort to force a refetch like a user would
  await page.getByRole('button', { name: 'Email' }).click()
  await expect(page.getByText('No users match the current filters.', { exact: true })).toBeVisible({
    timeout: 15_000,
  })
})

When(
  'an admin delete is attempted on the last admin with an API setup token',
  async ({ request, ctx }) => {
    const admin = requireStateAdmin(ctx)
    const setup = requireListed(ctx)
    const response = await request.delete(`/api/v1/admin/users/${admin.user.id}`, {
      headers: forgedAdminHeaders(setup.user.id, setup.user.email),
    })
    const state = deleteState(ctx)
    state.lastAdminStatus = response.status()
    const body = (await response.json()) as { message?: unknown }
    state.lastAdminMessage = typeof body.message === 'string' ? body.message : JSON.stringify(body)
  },
)

Then('the last-admin guard rejects with 409 verbatim', ({ ctx }) => {
  const state = deleteState(ctx)
  expect(state.lastAdminStatus).toBe(409)
  expect(state.lastAdminMessage ?? '').toContain('Cannot delete the last admin')
})

Then('self-deletion through the API is rejected with 403 verbatim', async ({ request, ctx }) => {
  // the guard chain rejects before draining or enqueuing, so this mutates nothing
  const admin = requireStateAdmin(ctx)
  const response = await request.delete(`/api/v1/admin/users/${admin.user.id}`, {
    headers: authHeaders(admin),
  })
  expect(response.status()).toBe(403)
  const body = (await response.json()) as { message?: unknown }
  expect(typeof body.message === 'string' ? body.message : JSON.stringify(body)).toContain(
    'Cannot delete your own account',
  )
})

When('I delete the victim user through the confirmation dialog', async ({ page, ctx }) => {
  const victim = requireVictim(ctx)
  await searchUsersFor(page, victim.user.email)
  const dialog = await openDeleteDialog(page, victim.user.displayName)
  await dialog.locator('#delete-user-confirm').fill('DELETE')
  await dialog.getByRole('button', { name: 'Delete user', exact: true }).click()
  await expect(page.getByText(`Deleted ${victim.user.displayName}.`, { exact: true })).toBeVisible({
    timeout: 120_000,
  })
})

Then('the victim deletion reaches a terminal state', async ({ request, ctx }) => {
  const admin = requireStateAdmin(ctx)
  const victim = requireVictim(ctx)
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/admin/users/${victim.user.id}/delete-status`, {
          headers: authHeaders(admin),
        })
        if (response.status() !== 200) return `http-${response.status()}`
        return ((await response.json()) as { state?: string }).state ?? 'missing'
      },
      { timeout: 120_000 },
    )
    .toBe('completed')
})

Then("the victim's photo derivatives regenerate", async ({ request, ctx, $testInfo }) => {
  // restore rebuilds rows plus original bytes only — the manifest carries no thumbnail rows,
  // so registered sizes can only come back when the per-run restore jobs actually run
  $testInfo.setTimeout(180_000)
  const state = deleteState(ctx)
  const victim = requireVictim(ctx)
  const assetId = state.victimAssetId
  if (!assetId) throw new Error('seed the victim library first')
  // the delete bumped tokensValidAfter (kept through the restore) — mint a fresh victim session
  const login = await request.post('/api/v1/auth/login', {
    data: { email: victim.user.email, password: PASSWORD },
  })
  expect(login.ok(), `victim re-login failed with status ${login.status()}`).toBe(true)
  const auth = (await login.json()) as AuthResponse
  await waitForThumbnails(request, auth, assetId, ['sm', 'md', 'lg', 'xl'])
})

Then('the victim library is gone but the victim backup is kept', async ({ request, ctx }) => {
  const state = deleteState(ctx)
  const admin = requireStateAdmin(ctx)
  const victim = requireVictim(ctx)
  // the admin users list no longer carries the id
  const listResponse = await request.get(
    `/api/v1/admin/users?q=${encodeURIComponent(victim.user.email)}`,
    { headers: authHeaders(admin) },
  )
  expect(listResponse.status()).toBe(200)
  const list = (await listResponse.json()) as { items: { id: string }[]; total: number }
  expect(list.total).toBe(0)
  expect(list.items).toHaveLength(0)
  // the victim session is dead on every owned surface
  for (const path of ['/api/v1/assets', '/api/v1/albums', '/api/v1/shares', '/api/v1/persons']) {
    const response = await request.get(path, { headers: authHeaders(victim) })
    expect(response.status()).toBe(401)
  }
  // the known file bytes are gone
  const fileId = state.victimFileId
  if (!fileId) throw new Error('seed the victim library first')
  const stream = await request.get(`/api/v1/files/${fileId}/stream`, {
    headers: authHeaders(admin),
  })
  expect(stream.status()).toBe(404)
  // the S3 backup prefix was never touched — same manifest counts as before the delete
  const backupAt = state.victimBackupAt
  if (!backupAt) throw new Error('back up the victim first')
  const statusResponse = await request.get(
    `/api/v1/admin/backups/status?emailOrId=${encodeURIComponent(victim.user.id)}`,
    { headers: authHeaders(admin) },
  )
  expect(statusResponse.status()).toBe(200)
  const status = (await statusResponse.json()) as {
    exists: boolean
    assets?: number
    backedUpAt?: string
  }
  expect(status.exists).toBe(true)
  expect(status.assets).toBe(state.victimBackupAssets)
  expect(status.backedUpAt).toBe(backupAt)
})

Then('the sibling library and backup are untouched', async ({ request, page, ctx }) => {
  const state = deleteState(ctx)
  const sibling = requireSibling(ctx)
  // still listed with a working Delete action
  const listResponse = await request.get(
    `/api/v1/admin/users?q=${encodeURIComponent(sibling.user.email)}`,
    { headers: authHeaders(requireStateAdmin(ctx)) },
  )
  expect(listResponse.status()).toBe(200)
  const list = (await listResponse.json()) as { items: { id: string }[]; total: number }
  expect(list.total).toBe(1)
  expect(list.items[0]?.id).toBe(sibling.user.id)
  await searchUsersFor(page, sibling.user.email)
  await expect(
    page.getByRole('button', { name: `Delete ${sibling.user.displayName}`, exact: true }),
  ).toBeEnabled()
  // their album, share and person stay readable
  const albumId = state.siblingAlbumId
  const shareToken = state.siblingShareToken
  const personId = state.siblingPersonId
  if (!albumId || !shareToken || !personId) throw new Error('seed the sibling library first')
  const albumResponse = await request.get(`/api/v1/albums/${albumId}`, {
    headers: authHeaders(sibling),
  })
  expect(albumResponse.status()).toBe(200)
  const shareResponse = await request.get(`/api/share/${shareToken}`)
  expect(shareResponse.status()).toBe(200)
  const personResponse = await request.get(`/api/v1/persons/${personId}`, {
    headers: authHeaders(sibling),
  })
  expect(personResponse.status()).toBe(200)
  // their backup status is unchanged since their backup
  const backupAt = state.siblingBackupAt
  if (!backupAt) throw new Error('back up the sibling first')
  const statusResponse = await request.get(
    `/api/v1/admin/backups/status?emailOrId=${encodeURIComponent(sibling.user.id)}`,
    { headers: authHeaders(requireStateAdmin(ctx)) },
  )
  expect(statusResponse.status()).toBe(200)
  const status = (await statusResponse.json()) as { exists: boolean; backedUpAt?: string }
  expect(status.exists).toBe(true)
  expect(status.backedUpAt).toBe(backupAt)
})

Then('the backups tab keeps the sibling row and stays usable', async ({ page, ctx }) => {
  const victim = requireVictim(ctx)
  const sibling = requireSibling(ctx)
  await page.goto('/admin?tab=backups')
  await expect(page.getByRole('heading', { name: 'User Backups' })).toBeVisible({
    timeout: 15_000,
  })
  const filter = page.getByLabel('Filter backups by email')
  // the overview now includes orphaned (deleted-user) backups, so the deleted account
  // stays in the table flagged as a deleted user while its S3 prefix stays intact
  // (proven by the status assert above)
  await filter.fill(victim.user.email)
  await expect(page.getByText(victim.user.email)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Deleted user').first()).toBeVisible()
  // a filter matching nothing still shows the empty state
  await filter.fill('nobody-matches-anything@example.com')
  await expect(page.getByText(/No users match/)).toBeVisible({ timeout: 15_000 })
  await filter.fill(sibling.user.email)
  await expect(page.getByText(sibling.user.email)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Backed up', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back up all users' })).toBeEnabled()
})

/** Narrows the backups table to one row; the email is unique per scenario. */
function backupRow(page: Page, email: string) {
  return page.locator('tbody tr').filter({ hasText: email })
}

When('I open the backups tab', async ({ page }) => {
  await page.goto('/admin?tab=backups')
  await expect(page.getByRole('heading', { name: 'User Backups' })).toBeVisible({
    timeout: 15_000,
  })
})

When('I filter backups to deleted accounts', async ({ page }) => {
  await page
    .getByRole('group', { name: 'Filter by account status' })
    .getByRole('button', { name: 'Deleted', exact: true })
    .click()
})

When('I filter backups to active accounts', async ({ page }) => {
  await page
    .getByRole('group', { name: 'Filter by account status' })
    .getByRole('button', { name: 'Active', exact: true })
    .click()
})

Then('the victim backup shows as a deleted user with a restore action', async ({ page, ctx }) => {
  const victim = requireVictim(ctx)
  await page.getByLabel('Filter backups by email').fill(victim.user.email)
  const row = backupRow(page, victim.user.email)
  await expect(row).toHaveCount(1, { timeout: 30_000 })
  await expect(row.getByText('Deleted user')).toBeVisible()
  await expect(row.getByRole('button', { name: `Restore ${victim.user.email}` })).toBeEnabled()
  // orphan rows cannot be re-backed-up — only restored or deleted
  await expect(
    row.getByRole('button', {
      name: `Back up ${victim.user.email} (deleted — restore first)`,
    }),
  ).toBeDisabled()
})

Then('the sibling backup stays active with a working backup action', async ({ page, ctx }) => {
  const sibling = requireSibling(ctx)
  await page.getByLabel('Filter backups by email').fill(sibling.user.email)
  const row = backupRow(page, sibling.user.email)
  await expect(row).toHaveCount(1, { timeout: 30_000 })
  await expect(row.getByText('Deleted user')).toHaveCount(0)
  await expect(row.getByRole('button', { name: `Restore ${sibling.user.email}` })).toHaveCount(0)
  await expect(
    row.getByRole('button', { name: `Back up ${sibling.user.email}`, exact: true }),
  ).toBeEnabled()
})

When('the victim backup is restored through the API', async ({ request, ctx, $testInfo }) => {
  // the restore rebuilds rows + copies bytes inline, then re-queues derivatives
  $testInfo.setTimeout(360_000)
  const response = await request.post('/api/v1/admin/restores', {
    headers: authHeaders(requireStateAdmin(ctx)),
    data: { emailOrId: requireVictim(ctx).user.id },
  })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { email?: string }
  if (!body.email) throw new Error('restore response is missing the restored email')
  deleteState(ctx).restoredEmail = body.email
})

When('the victim email is re-registered by a new user', async ({ request, ctx }) => {
  // the victim row is gone, so the address is free — a new account takes it, forcing the
  // next restore of the victim backup onto the restored-<ms>-<orig> fallback
  deleteState(ctx).reregistered = await registerUser(request, requireVictim(ctx).user.email)
})

When(
  'I restore the victim backup through the confirmation dialog',
  async ({ page, ctx, $testInfo }) => {
    $testInfo.setTimeout(360_000)
    const victim = requireVictim(ctx)
    await page.getByLabel('Filter backups by email').fill(victim.user.email)
    // this step serves both rows: the true-orphan main row keeps `Restore ${email}` while the
    // previous-account sub-row carries `Restore to a new account ${email}`
    const restore = page.getByRole('button', {
      name: new RegExp(`^Restore( to a new account)? ${escapeRegExp(victim.user.email)}$`),
    })
    await expect(restore).toBeEnabled({ timeout: 30_000 })
    await restore.click()
    await expect(
      page.getByRole('heading', { name: `Restore ${victim.user.email}?`, exact: true }),
    ).toBeVisible()
    // the optional target-address input must be offered; leaving it empty keeps the fallback
    await expect(page.getByLabel('New account email')).toBeVisible()
    // the confirm closes before the run, so register the waiter first and pin the outcome
    // on the response — the Then steps assert the toast + refreshed list, never a bare wait
    const pending = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/admin/restores') && response.request().method() === 'POST',
      { timeout: 120_000 },
    )
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    deleteState(ctx).restoreStatus = (await pending).status()
  },
)

Then(
  'the already-restored conflict is shown and the victim account is live again',
  async ({ page, ctx }) => {
    const victim = requireVictim(ctx)
    // the row the dialog was opened from went stale when the API restored first
    expect(deleteState(ctx).restoreStatus).toBe(409)
    // unlike the delete-user dialog (which stays open on failure) the restore confirm
    // closes before the run — the 409 surfaces as a toast plus a row error, then the
    // version bump refetches the overview
    await expect(
      page.getByRole('heading', { name: `Restore ${victim.user.email}?`, exact: true }),
    ).toHaveCount(0)
    await expect(page.getByText(/That account is already back/).first()).toBeVisible({
      timeout: 10_000,
    })
    // the refetch drops the orphan flag, so the row comes back live with a working Backup
    // the scenario's status filter is still Deleted from two steps earlier, which would
    // filter out the refreshed live row — reset to All first (same selector as the
    // `I filter backups to ...` helpers above)
    await page
      .getByRole('group', { name: 'Filter by account status' })
      .getByRole('button', { name: 'All', exact: true })
      .click()
    await page.getByLabel('Filter backups by email').fill(victim.user.email)
    const row = backupRow(page, victim.user.email)
    await expect(row).toHaveCount(1, { timeout: 30_000 })
    await expect(
      row.getByRole('button', { name: `Back up ${victim.user.email}`, exact: true }),
    ).toBeEnabled({ timeout: 30_000 })
    await expect(row.getByText('Deleted user')).toHaveCount(0)
    await expect(row.getByRole('button', { name: `Restore ${victim.user.email}` })).toHaveCount(0)
  },
)

Then('the restore toast names the fallback address', async ({ page, request, ctx }) => {
  const state = deleteState(ctx)
  const victim = requireVictim(ctx)
  expect(state.restoreStatus).toBe(200)
  // the toast auto-dismisses after ~3s, so assert it before the overview poll below
  await expect(page.getByText(/Restored restored-\d+-/).first()).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText(/Sign in as restored-\d+-/).first()).toBeVisible({
    timeout: 10_000,
  })
  // the live row for the restored userId carries the actual address the toast named
  let fallback = ''
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/v1/admin/backups/overview', {
          headers: authHeaders(requireStateAdmin(ctx)),
        })
        if (response.status() !== 200) return ''
        const rows = (await response.json()) as { userId: string; email: string }[]
        fallback = rows.find((row) => row.userId === victim.user.id)?.email ?? ''
        return fallback
      },
      { timeout: 60_000 },
    )
    .toMatch(/^restored-\d+-/)
  state.restoredEmail = fallback
})

Then(
  'the fallback account signs in with the old password while the re-registered account keeps the email',
  async ({ request, ctx }) => {
    const state = deleteState(ctx)
    const victim = requireVictim(ctx)
    const reregistered = state.reregistered
    const fallback = state.restoredEmail
    if (!reregistered) throw new Error('re-register the victim email first')
    if (!fallback) throw new Error('restore the victim backup first')
    // the restored account keeps its old password under the fallback address
    const fallbackLogin = await request.post('/api/v1/auth/login', {
      data: { email: fallback, password: PASSWORD },
    })
    expect(fallbackLogin.ok(), `fallback login failed with status ${fallbackLogin.status()}`).toBe(
      true,
    )
    expect(((await fallbackLogin.json()) as AuthResponse).user.id).toBe(victim.user.id)
    // the address itself still belongs to the re-registered account, untouched
    const originalLogin = await request.post('/api/v1/auth/login', {
      data: { email: victim.user.email, password: PASSWORD },
    })
    expect(originalLogin.ok(), `original login failed with status ${originalLogin.status()}`).toBe(
      true,
    )
    expect(((await originalLogin.json()) as AuthResponse).user.id).toBe(reregistered.user.id)
  },
)

// --- previous-account backup merge ---------------------------------------------------------
// A deleted account's snapshot is matched to the live account that re-registered its email.
// The live row keeps its own Back up / Delete pair while each matched snapshot renders in a
// sub-row table under it; merging copies the source library into the live account and moves
// the S3 snapshot into the live account's prefix (deleting the source prefix), and the ledger
// rejects a repeat.

interface MergedOverviewRow {
  userId: string
  exists: boolean
  backedUpAssets: number
  legacyBackups?: { userId: string; assets?: number }[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

When('I search backups for the victim email', async ({ page, ctx }) => {
  await page.getByLabel('Filter backups by email').fill(requireVictim(ctx).user.email)
})

Then('the matched backup row shows the previous-account merge action', async ({ page, ctx }) => {
  const email = requireVictim(ctx).user.email
  // the live account's main row is the only row carrying the email text — the snapshot's
  // sub-row table below it labels its buttons with the address, never as plain text
  const row = backupRow(page, email)
  await expect(row).toHaveCount(1, { timeout: 30_000 })
  await expect(row.getByText('Deleted user')).toHaveCount(0)
  // the live account has no own backup, so its main row shows the plain Back up / Delete pair
  await expect(row.getByRole('button', { name: `Back up ${email}`, exact: true })).toBeEnabled()
  await expect(
    row.getByRole('button', { name: `Delete backup for ${email}`, exact: true }),
  ).toBeVisible()
  // the previous account's snapshot renders in the sub-row table under the main row
  await expect(page.getByText('Previous account').first()).toBeVisible()
  // the first snapshot carries the un-dated labels — exact matching keeps them apart from the
  // dated variants reserved for any further snapshots
  await expect(
    page.getByRole('button', { name: `Merge to current live account ${email}`, exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: `Restore to a new account ${email}`, exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: `Delete previous backup for ${email}`, exact: true }),
  ).toBeVisible()
})

When('I merge the matched backup into the live account', async ({ page, ctx, $testInfo }) => {
  // the merge copies the source originals inline (deduping checksums) — allow room past 120s
  $testInfo.setTimeout(360_000)
  const email = requireVictim(ctx).user.email
  const merge = page.getByRole('button', {
    name: `Merge to current live account ${email}`,
    exact: true,
  })
  await expect(merge).toBeEnabled({ timeout: 30_000 })
  await merge.click()
  await expect(
    page.getByRole('heading', { name: `Merge backup into ${email}?`, exact: true }),
  ).toBeVisible()
  // the confirm closes before the run, so register the waiter first and pin the outcome on
  // the response — the toast proves the overview refreshed afterwards
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/admin/restores/merge',
    { timeout: 240_000 },
  )
  await page.getByRole('button', { name: 'Merge', exact: true }).click()
  expect((await pending).status()).toBe(200)
  await expect(
    page.getByText(new RegExp(`Merged .* into ${escapeRegExp(email)}`)).first(),
  ).toBeVisible({ timeout: 15_000 })
})

Then('the live account owns the backup library', async ({ request, ctx }) => {
  const state = deleteState(ctx)
  const admin = requireStateAdmin(ctx)
  const reregistered = state.reregistered
  if (!reregistered) throw new Error('re-register the victim email first')
  const liveId = reregistered.user.id
  // the merge moves the source snapshot under the live account's own prefix, so its row
  // reports one merged library and no previous-account sub-row is left behind
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/v1/admin/backups/overview', {
          headers: authHeaders(admin),
        })
        if (response.status() !== 200) return false
        const rows = (await response.json()) as MergedOverviewRow[]
        const row = rows.find((candidate) => candidate.userId === liveId)
        return Boolean(
          row?.exists && row.backedUpAssets >= 1 && (row.legacyBackups ?? []).length === 0,
        )
      },
      { timeout: 60_000 },
    )
    .toBe(true)
})

Then('the source backup is gone', async ({ request, ctx }) => {
  const state = deleteState(ctx)
  const victim = requireVictim(ctx)
  const admin = requireStateAdmin(ctx)
  const reregistered = state.reregistered
  if (!reregistered) throw new Error('re-register the victim email first')
  const statusFor = async (emailOrId: string) => {
    const response = await request.get(
      `/api/v1/admin/backups/status?emailOrId=${encodeURIComponent(emailOrId)}`,
      { headers: authHeaders(admin) },
    )
    expect(response.status()).toBe(200)
    return (await response.json()) as { exists: boolean; assets?: number }
  }
  // moving the snapshot deletes the source prefix, so the deleted account no longer owns one
  expect((await statusFor(victim.user.id)).exists).toBe(false)
  // the live account is the one that now exists, owning the merged library
  const live = await statusFor(reregistered.user.id)
  expect(live.exists).toBe(true)
  expect(live.assets).toBe(1)
})

Then('a second merge is rejected', async ({ request, ctx }) => {
  const state = deleteState(ctx)
  const victim = requireVictim(ctx)
  const reregistered = state.reregistered
  if (!reregistered) throw new Error('re-register the victim email first')
  const response = await request.post('/api/v1/admin/restores/merge', {
    headers: authHeaders(requireStateAdmin(ctx)),
    data: { targetEmailOrId: reregistered.user.id, backupUserId: victim.user.id },
  })
  expect(response.status()).toBe(409)
  let body: { message?: unknown } = {}
  try {
    body = (await response.json()) as { message?: unknown }
  } catch {
    // a bodyless 409 still proves the repeat merge was rejected
  }
  if (body.message !== undefined) {
    // the HTTP filter may shape the message as a string or an array of strings
    const message = typeof body.message === 'string' ? body.message : JSON.stringify(body.message)
    expect(message).toContain('already-merged')
  }
})
