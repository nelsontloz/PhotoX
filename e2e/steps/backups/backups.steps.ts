import { randomUUID } from 'node:crypto'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import {
  Given,
  Then,
  When,
  PASSWORD,
  authHeaders,
  getAsset,
  injectSession,
  registerUser,
  requireAuth,
  uploadViaApi,
  type AuthResponse,
  type Ctx,
} from '../support'

const ADMIN_EMAIL = 'admin@photox.test'

/** Trimmed wire shapes of the admin backup endpoints (see BackupController). */
interface BackupResult {
  userId: string
  email: string
  prefix: string
  backedUpAt: string
  files: number
  assets: number
  uploaded: number
  skipped: number
}

interface BackupStatus {
  exists: boolean
  degraded?: 'unreadable' | 'corrupt'
  userId?: string
  backedUpAt?: string
  files?: number
  assets?: number
}

interface BackupOverviewRow {
  userId: string
  email: string
  totalAssets: number
  backedUpAssets: number
  backedUpFiles: number
  backedUpAt: string | null
  exists: boolean
  degraded?: 'unreadable' | 'corrupt'
  // a deleted snapshot whose email matches a live account is reported on that live row and
  // carries the snapshot's own account id plus the merge marker (see the merge scenario in
  // 13-admin-user-delete); older rows simply omit them
  backupUserId?: string
  prefix?: string
  mergedAt?: string | null
  legacyBackups?: unknown
}

interface BackupProgress {
  userId: string
  inProgress: boolean
  total: number
  completed: number
  uploaded: number
  skipped: number
}

/** Per-scenario backup state, keyed by the scenario ctx (support.ts Ctx untouched). */
interface BackupState {
  admin?: AuthResponse
  assetIds: string[]
  otherAuth?: AuthResponse
  allUsers?: AuthResponse[]
  results: BackupResult[]
  myBackedUpAt?: string
  victim?: AuthResponse
  liveUser?: AuthResponse
  liveAssetId?: string
  activeUser?: AuthResponse
  deletedVictim?: AuthResponse
  orphanBackupAt?: string
  backupAllTargets?: string[]
}

const states = new WeakMap<Ctx, BackupState>()

function backupState(ctx: Ctx): BackupState {
  let state = states.get(ctx)
  if (!state) {
    state = { assetIds: [], results: [] }
    states.set(ctx, state)
  }
  return state
}

/** Admin login against the seeded admin; memoized per worker like the faces steps so serial
 * admin scenarios share one login instead of tripping the login throttle. This feature runs in
 * the parallel `suite` project, though, where each worker has its own module cache — N workers
 * would mean N concurrent admin logins against the 5/900s per-email throttle (the serial
 * `setup` project already spends 3: bootstrap UI + API logins and one faces login). So the
 * workers additionally share one login through a tmp file: exactly one leader spends a single
 * login and followers adopt its session instead of retrying into a 429. */
let cachedAdmin: { auth: AuthResponse; at: number } | null = null
const ADMIN_SESSION_REUSE_MS = 20 * 60 * 1000
// run.sh exports a unique E2E_WEB_PORT per run, isolating parallel runs sharing this tmpdir
const ADMIN_SESSION_FILE = join(
  tmpdir(),
  `photox-e2e-admin-session-${process.env.E2E_WEB_PORT ?? 'default'}.json`,
)
const ADMIN_SESSION_LOCK = `${ADMIN_SESSION_FILE}.lock`

async function readSharedAdmin(): Promise<AuthResponse | null> {
  try {
    const parsed = JSON.parse(await readFile(ADMIN_SESSION_FILE, 'utf8')) as {
      auth?: AuthResponse
      at?: number
    }
    if (
      parsed.auth?.accessToken &&
      parsed.auth.user?.role === 'admin' &&
      typeof parsed.at === 'number' &&
      Date.now() - parsed.at < ADMIN_SESSION_REUSE_MS
    ) {
      return parsed.auth
    }
  } catch {
    // cold start or a half-written file from a racing worker — fall through to the login path
  }
  return null
}

async function waitForSharedAdmin(timeoutMs: number): Promise<AuthResponse | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const auth = await readSharedAdmin()
    if (auth) return auth
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function writeSharedAdmin(auth: AuthResponse): Promise<void> {
  try {
    await writeFile(ADMIN_SESSION_FILE, JSON.stringify({ auth, at: Date.now() }), 'utf8')
  } catch {
    // best-effort cross-worker hint; the in-memory cache still covers this worker
  }
}

async function signInAdmin(request: APIRequestContext): Promise<AuthResponse> {
  if (cachedAdmin && Date.now() - cachedAdmin.at < ADMIN_SESSION_REUSE_MS) {
    return cachedAdmin.auth
  }
  const shared = await readSharedAdmin()
  if (shared) {
    cachedAdmin = { auth: shared, at: Date.now() }
    return shared
  }
  // leader election so the cold-start herd spends exactly one login, not one per worker
  let leader = false
  try {
    try {
      const stale = await stat(ADMIN_SESSION_LOCK)
      if (Date.now() - stale.mtimeMs > 60_000) await unlink(ADMIN_SESSION_LOCK)
    } catch {
      // no lock file — nothing stale to break
    }
    await writeFile(ADMIN_SESSION_LOCK, String(process.pid), { flag: 'wx' })
    leader = true
  } catch {
    leader = false
  }
  if (!leader) {
    const adopted = await waitForSharedAdmin(60_000)
    if (adopted) {
      cachedAdmin = { auth: adopted, at: Date.now() }
      return adopted
    }
    // the leader died without writing — fall through and try the login ourselves
  }
  try {
    let response = await request.post('/api/v1/auth/login', {
      data: { email: ADMIN_EMAIL, password: PASSWORD },
    })
    if (!response.ok()) {
      response = await request.post('/api/v1/auth/register', {
        data: { email: ADMIN_EMAIL, password: PASSWORD, displayName: 'E2E Admin' },
      })
    }
    expect(response.ok(), `admin auth failed with status ${response.status()}`).toBe(true)
    const auth = (await response.json()) as AuthResponse
    if (auth.user.role !== 'admin') {
      throw new Error(`expected ${ADMIN_EMAIL} to have the admin role, got "${auth.user.role}"`)
    }
    cachedAdmin = { auth, at: Date.now() }
    await writeSharedAdmin(auth)
    return auth
  } finally {
    if (leader) await unlink(ADMIN_SESSION_LOCK).catch(() => undefined)
  }
}

async function requireAdmin(request: APIRequestContext, state: BackupState): Promise<AuthResponse> {
  state.admin ??= await signInAdmin(request)
  return state.admin
}

async function runBackup(
  request: APIRequestContext,
  state: BackupState,
  emailOrId: string,
): Promise<BackupResult> {
  const response = await request.post('/api/v1/admin/backups', {
    headers: authHeaders(await requireAdmin(request, state)),
    data: { emailOrId },
  })
  expect(response.status()).toBe(200)
  const result = (await response.json()) as BackupResult
  state.results.push(result)
  return result
}

function latestResult(state: BackupState): BackupResult {
  const result = state.results[state.results.length - 1]
  if (!result) throw new Error('back up an account first')
  return result
}

async function fetchStatus(
  request: APIRequestContext,
  admin: AuthResponse,
  emailOrId: string,
): Promise<BackupStatus> {
  const response = await request.get(
    `/api/v1/admin/backups/status?emailOrId=${encodeURIComponent(emailOrId)}`,
    { headers: authHeaders(admin) },
  )
  expect(response.status()).toBe(200)
  return (await response.json()) as BackupStatus
}

async function fetchOverview(
  request: APIRequestContext,
  admin: AuthResponse,
): Promise<BackupOverviewRow[]> {
  const response = await request.get('/api/v1/admin/backups/overview', {
    headers: authHeaders(admin),
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as BackupOverviewRow[]
}

async function fetchProgress(
  request: APIRequestContext,
  admin: AuthResponse,
  emailOrId: string,
): Promise<BackupProgress> {
  const response = await request.get(
    `/api/v1/admin/backups/progress?emailOrId=${encodeURIComponent(emailOrId)}`,
    { headers: authHeaders(admin) },
  )
  expect(response.status()).toBe(200)
  return (await response.json()) as BackupProgress
}

/** The overview is global (one row per user) — always filter to the scenario's own row. */
function overviewRow(rows: BackupOverviewRow[], userId: string): BackupOverviewRow {
  const row = rows.find((candidate) => candidate.userId === userId)
  if (!row) throw new Error(`no backup overview row for user ${userId}`)
  return row
}

Given('I upload two photos for backup through the API', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const state = backupState(ctx)
  state.assetIds.push(await uploadViaApi(request, auth, 'photo.jpg'))
  state.assetIds.push(await uploadViaApi(request, auth, 'photo-text.jpg'))
})

Given('I upload one photo for backup through the API', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  backupState(ctx).assetIds.push(await uploadViaApi(request, auth, 'photo.jpg'))
})

When('I upload one more photo for backup through the API', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  // face.jpg is the only remaining photo fixture — re-uploading an earlier fixture would hit
  // the same-user dedup path instead of adding a new file
  backupState(ctx).assetIds.push(await uploadViaApi(request, auth, 'face.jpg'))
})

Given('a second user with one photo is registered', async ({ request, ctx }) => {
  requireAuth(ctx)
  const state = backupState(ctx)
  const other = await registerUser(request)
  state.otherAuth = other
  // a different fixture from my photo.jpg so a shared checksum can never alias the two users
  await uploadViaApi(request, other, 'photo-text.jpg')
})

Given('two users each with one photo are registered', async ({ request, ctx }) => {
  const state = backupState(ctx)
  const first = await registerUser(request)
  await uploadViaApi(request, first, 'photo.jpg')
  const second = await registerUser(request)
  await uploadViaApi(request, second, 'photo-text.jpg')
  state.allUsers = [first, second]
})

When('an administrator backs up my account', async ({ request, ctx }) => {
  const state = backupState(ctx)
  const result = await runBackup(request, state, requireAuth(ctx).user.id)
  state.myBackedUpAt = result.backedUpAt
})

When('an administrator backs up my account again', async ({ request, ctx, $testInfo }) => {
  // the incremental scenario chains three backups — allow room beyond the 120s default
  $testInfo.setTimeout(240_000)
  await runBackup(request, backupState(ctx), requireAuth(ctx).user.id)
})

When("an administrator backs up the other user's account", async ({ request, ctx }) => {
  const state = backupState(ctx)
  const other = state.otherAuth
  if (!other) throw new Error('register the second user first')
  await runBackup(request, state, other.user.id)
})

When('an administrator backs up every user serially', async ({ request, ctx, $testInfo }) => {
  $testInfo.setTimeout(240_000)
  const state = backupState(ctx)
  const users = state.allUsers
  if (!users) throw new Error('register the backup-all users first')
  // mirror the UI runAll for-loop: one user at a time, never concurrent
  for (const user of users) {
    await runBackup(request, state, user.user.id)
  }
})

Then(
  'the backup result is {int} uploaded and {int} skipped',
  ({ ctx }, uploaded: number, skipped: number) => {
    const result = latestResult(backupState(ctx))
    expect(result.uploaded).toBe(uploaded)
    expect(result.skipped).toBe(skipped)
  },
)

Then('the backup prefix contains my user id', ({ ctx }) => {
  expect(latestResult(backupState(ctx)).prefix).toContain(requireAuth(ctx).user.id)
})

Then('my backup status reports {int} assets', async ({ request, ctx }, assets: number) => {
  const state = backupState(ctx)
  const status = await fetchStatus(
    request,
    await requireAdmin(request, state),
    requireAuth(ctx).user.id,
  )
  expect(status.exists).toBe(true)
  expect(status.assets).toBe(assets)
})

Then('the backup progress for my account is idle', async ({ request, ctx }) => {
  // liveness only: a known user with no running backup reports an idle zero snapshot
  const state = backupState(ctx)
  const progress = await fetchProgress(
    request,
    await requireAdmin(request, state),
    requireAuth(ctx).user.id,
  )
  expect(progress.inProgress).toBe(false)
})

Then(
  'the backup overview shows my account as backed up with {int} assets',
  async ({ request, ctx }, assets: number) => {
    const state = backupState(ctx)
    const rows = await fetchOverview(request, await requireAdmin(request, state))
    const row = overviewRow(rows, requireAuth(ctx).user.id)
    expect(row.exists).toBe(true)
    expect(row.backedUpAssets).toBe(assets)
  },
)

Then("the other user's backup status shows no backup", async ({ request, ctx }) => {
  const state = backupState(ctx)
  const other = state.otherAuth
  if (!other) throw new Error('register the second user first')
  const status = await fetchStatus(request, await requireAdmin(request, state), other.user.id)
  expect(status.exists).toBe(false)
})

Then(
  "the other user's backup status reports {int} assets",
  async ({ request, ctx }, assets: number) => {
    const state = backupState(ctx)
    const other = state.otherAuth
    if (!other) throw new Error('register the second user first')
    const status = await fetchStatus(request, await requireAdmin(request, state), other.user.id)
    expect(status.exists).toBe(true)
    expect(status.assets).toBe(assets)
  },
)

Then('my backup status is unchanged since my backup', async ({ request, ctx }) => {
  const state = backupState(ctx)
  const stamped = state.myBackedUpAt
  if (!stamped) throw new Error('back up my account first')
  const status = await fetchStatus(
    request,
    await requireAdmin(request, state),
    requireAuth(ctx).user.id,
  )
  expect(status.exists).toBe(true)
  expect(status.backedUpAt).toBe(stamped)
})

Then('both users show as backed up in the overview', async ({ request, ctx }) => {
  const state = backupState(ctx)
  const users = state.allUsers
  if (!users) throw new Error('register the backup-all users first')
  const rows = await fetchOverview(request, await requireAdmin(request, state))
  const mine = rows.filter((row) => users.some((user) => user.user.id === row.userId))
  expect(mine).toHaveLength(users.length)
  for (const row of mine) {
    expect(row.exists).toBe(true)
    expect(row.backedUpAssets).toBe(1)
  }
})

Then(
  'an administrator sees the backups table with a Back up all button',
  async ({ request, page, baseURL, ctx }) => {
    await injectSession(page, await requireAdmin(request, backupState(ctx)), baseURL)
    await page.goto('/admin?tab=backups')
    await expect(page.getByRole('heading', { name: 'User Backups' })).toBeVisible({
      timeout: 15_000,
    })
    // the overview reads every user's manifest back from S3 and the web client allows 30s
    // (BACKUP_STATUS_TIMEOUT_MS) before it gives up — a busy 4-worker run can exceed 15s, so
    // wait past the client's own cap; a genuinely failed load still shows the Retry card
    await expect(page.locator('table')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('button', { name: 'Back up all' })).toBeVisible()
  },
)

// --- backup orphans / restore / delete ------------------------------------------------------
// Deleted-user backups ("orphans") keep their S3 prefix after the account is gone. Every
// setup below is API-only (register → photo → inline backup → async user delete to a
// terminal delete-status); every assert is UI-first on the backups tab, reusing the shared
// admin login above — no new login flows.

/** Account deletion is async (202 + worker): poll delete-status to the terminal state. */
async function deleteUserViaApi(
  request: APIRequestContext,
  admin: AuthResponse,
  userId: string,
): Promise<void> {
  const response = await request.delete(`/api/v1/admin/users/${userId}`, {
    headers: authHeaders(admin),
  })
  expect(response.status()).toBe(202)
  await expect
    .poll(
      async () => {
        const status = await request.get(`/api/v1/admin/users/${userId}/delete-status`, {
          headers: authHeaders(admin),
        })
        if (status.status() !== 200) return `http-${status.status()}`
        return ((await status.json()) as { state?: string }).state ?? 'missing'
      },
      { timeout: 120_000 },
    )
    .toBe('completed')
}

function requireVictim(state: BackupState): AuthResponse {
  if (!state.victim) throw new Error('register the backup orphan victim first')
  return state.victim
}

function requireLiveUser(state: BackupState): AuthResponse {
  if (!state.liveUser) throw new Error('register the live backup user first')
  return state.liveUser
}

function requireActiveUser(state: BackupState): AuthResponse {
  if (!state.activeUser) throw new Error('register the backup-all users first')
  return state.activeUser
}

function requireDeletedVictim(state: BackupState): AuthResponse {
  if (!state.deletedVictim) throw new Error('register the backup-all users first')
  return state.deletedVictim
}

async function openBackupsTab(
  page: Page,
  baseURL: string | undefined,
  request: APIRequestContext,
  state: BackupState,
): Promise<void> {
  await injectSession(page, await requireAdmin(request, state), baseURL)
  await page.goto('/admin?tab=backups')
  await expect(page.getByRole('heading', { name: 'User Backups' })).toBeVisible({
    timeout: 15_000,
  })
}

function searchBackups(page: Page, email: string): Promise<void> {
  // the table lists every user in the shared instance — narrow to this scenario's row first
  return page.getByLabel('Filter backups by email').fill(email)
}

function deleteBackupDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Delete backup confirmation' })
}

async function confirmTypedDeleteBackup(page: Page, email: string): Promise<number> {
  const dialog = deleteBackupDialog(page)
  await expect(dialog).toBeVisible()
  await dialog.locator('#delete-backup-confirm').fill('DELETE')
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname === '/api/v1/admin/backups',
  )
  await dialog.getByRole('button', { name: 'Delete backup', exact: true }).click()
  const response = await answered
  expect(response.status()).toBe(200)
  // the delete bumps the overview version and refetches — the toast proves whose prefix went
  await expect(page.getByText(`Deleted backup for ${email}`)).toBeVisible({ timeout: 15_000 })
  return response.status()
}

Given(
  'a backed-up user with one photo is registered as the backup orphan victim',
  async ({ request, ctx, $testInfo }) => {
    // one inline S3 backup plus an async user deletion — allow room past the 120s default
    $testInfo.setTimeout(240_000)
    const state = backupState(ctx)
    const admin = await requireAdmin(request, state)
    const victim = await registerUser(request, `victim-${randomUUID()}@photox.test`)
    state.victim = victim
    await uploadViaApi(request, victim, 'photo.jpg')
    await runBackup(request, state, victim.user.id)
    await deleteUserViaApi(request, admin, victim.user.id)
  },
)

Given(
  'a backed-up user with one photo is registered for live backup deletion',
  async ({ request, ctx, $testInfo }) => {
    $testInfo.setTimeout(240_000)
    const state = backupState(ctx)
    const user = await registerUser(request, `live-${randomUUID()}@photox.test`)
    state.liveUser = user
    state.liveAssetId = await uploadViaApi(request, user, 'photo.jpg')
    await runBackup(request, state, user.user.id)
  },
)

Given(
  'an active backed-up user and a deleted backed-up orphan are registered',
  async ({ request, ctx, $testInfo }) => {
    // two inline S3 backups plus an async user deletion — allow room past the 120s default
    $testInfo.setTimeout(360_000)
    const state = backupState(ctx)
    const admin = await requireAdmin(request, state)
    const active = await registerUser(request, `active-${randomUUID()}@photox.test`)
    state.activeUser = active
    await uploadViaApi(request, active, 'photo.jpg')
    await runBackup(request, state, active.user.id)
    // a different fixture from the active user's so a shared checksum can never alias the two
    const gone = await registerUser(request, `victim-${randomUUID()}@photox.test`)
    state.deletedVictim = gone
    await uploadViaApi(request, gone, 'photo-text.jpg')
    state.orphanBackupAt = (await runBackup(request, state, gone.user.id)).backedUpAt
    await deleteUserViaApi(request, admin, gone.user.id)
  },
)

Given('an administrator opens the backups tab', async ({ request, page, baseURL, ctx }) => {
  await openBackupsTab(page, baseURL, request, backupState(ctx))
})

When('I filter backups by {string}', async ({ page }, which: string) => {
  const group = page.getByRole('group', { name: 'Filter by account status' })
  const option = group.getByRole('button', { name: which, exact: true })
  await option.click()
  await expect(option).toHaveAttribute('aria-pressed', 'true')
})

When('I search backups for the orphan victim', async ({ page, ctx }) => {
  await searchBackups(page, requireVictim(backupState(ctx)).user.email)
})

When('I search backups for the live backup user', async ({ page, ctx }) => {
  await searchBackups(page, requireLiveUser(backupState(ctx)).user.email)
})

Then('the orphan victim row shows the deleted orphan actions', async ({ page, ctx }) => {
  const email = requireVictim(backupState(ctx)).user.email
  await searchBackups(page, email)
  await expect(page.getByText('Deleted user').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: `Restore ${email}`, exact: true })).toBeEnabled()
  // orphans restore, they never re-back-up: the per-row Backup stays disabled by design
  await expect(
    page.getByRole('button', {
      name: `Back up ${email} (deleted — restore first)`,
      exact: true,
    }),
  ).toBeDisabled()
})

Then('the orphan victim is hidden from the backups table', async ({ page, ctx }) => {
  const email = requireVictim(backupState(ctx)).user.email
  await searchBackups(page, email)
  await expect(page.getByText(/No users match/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: `Restore ${email}`, exact: true })).toHaveCount(0)
})

When(
  'I restore the orphan victim through the confirmation dialog',
  async ({ page, ctx, $testInfo }) => {
    // the restore copies S3 bytes back inline — allow room past the 120s default
    $testInfo.setTimeout(240_000)
    const email = requireVictim(backupState(ctx)).user.email
    const restore = page.getByRole('button', { name: `Restore ${email}`, exact: true })
    await expect(restore).toBeEnabled()
    await restore.click()
    await expect(page.getByRole('heading', { name: `Restore ${email}?` })).toBeVisible()
    // the ConfirmDialog shell carries no dialog role, so the confirm is pinned by its exact
    // label: the row button's `Restore <email>` name can never match it
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/admin/restores',
      { timeout: 240_000 },
    )
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    // the controller answers 200 (HttpCode OK) with the restored address in the body
    expect((await answered).status()).toBe(200)
  },
)

Then('the orphan victim restore toast names the restored account', async ({ page, ctx }) => {
  const email = requireVictim(backupState(ctx)).user.email
  // the toast fades after ~3s, so catch it on first paint — the address is the fallback-proof
  // proof of who came back (restore falls back to restored-<ms>-<orig> when taken)
  await expect(page.getByText(`Sign in as ${email}`)).toBeVisible({ timeout: 15_000 })
})

Then('the orphan victim row shows as active with backup enabled', async ({ page, ctx }) => {
  const email = requireVictim(backupState(ctx)).user.email
  await searchBackups(page, email)
  // the restore bumps the overview version and refetches: wait for the live row to land
  await expect(page.getByRole('button', { name: `Back up ${email}`, exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await expect(page.getByText('Deleted user')).toHaveCount(0)
  await expect(page.getByText('Backed up', { exact: true }).first()).toBeVisible()
})

When('I open the delete backup dialog for that live user', async ({ page, ctx }) => {
  const email = requireLiveUser(backupState(ctx)).user.email
  await page.getByRole('button', { name: `Delete backup for ${email}`, exact: true }).click()
  await expect(deleteBackupDialog(page)).toBeVisible()
})

Then('the live delete dialog shows the prefix and counts', async ({ page, ctx }) => {
  const user = requireLiveUser(backupState(ctx))
  const dialog = deleteBackupDialog(page)
  // the dialog previews the exact S3 prefix plus the manifest counts before anything is armed
  await expect(dialog.locator('code')).toContainText('backups/')
  await expect(dialog.locator('code')).toContainText(user.user.id)
  await expect(dialog.getByText(/assets and/)).toBeVisible()
})

Then('the backup delete confirm stays disabled until DELETE is typed exactly', async ({ page }) => {
  const dialog = deleteBackupDialog(page)
  const input = dialog.locator('#delete-backup-confirm')
  const confirm = dialog.getByRole('button', { name: 'Delete backup', exact: true })
  await expect(confirm).toBeDisabled()
  await input.fill('delete')
  await expect(confirm).toBeDisabled()
  await input.fill(' DELETE ')
  await expect(confirm).toBeDisabled()
  await input.fill('DELETE')
  await expect(confirm).toBeEnabled()
})

Then(
  'cancelling or escaping the live delete dialog issues no backup delete request',
  async ({ page, ctx }) => {
    const email = requireLiveUser(backupState(ctx)).user.email
    // the dialog starts open with DELETE typed (previous step) — both dismissals must be
    // network-silent, so count DELETEs instead of sleeping and asserting absence
    let deletes = 0
    await page.route('**/api/v1/admin/backups', async (route) => {
      if (route.request().method() === 'DELETE') deletes += 1
      await route.continue()
    })
    try {
      await deleteBackupDialog(page).getByRole('button', { name: 'Cancel' }).click()
      await expect(deleteBackupDialog(page)).toHaveCount(0)
      await page.getByRole('button', { name: `Delete backup for ${email}`, exact: true }).click()
      await expect(deleteBackupDialog(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(deleteBackupDialog(page)).toHaveCount(0)
    } finally {
      await page.unroute('**/api/v1/admin/backups')
    }
    expect(deletes).toBe(0)
  },
)

When('I confirm live backup deletion with typed DELETE', async ({ page, ctx }) => {
  const email = requireLiveUser(backupState(ctx)).user.email
  await page.getByRole('button', { name: `Delete backup for ${email}`, exact: true }).click()
  await confirmTypedDeleteBackup(page, email)
})

Then('the live backup row shows no backup', async ({ page, ctx }) => {
  const email = requireLiveUser(backupState(ctx)).user.email
  await searchBackups(page, email)
  // the delete bumps the overview version and refetches: wait for the emptied row to land
  await expect(page.getByText('None', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: `Back up ${email}`, exact: true })).toBeEnabled()
})

Then('the live account and library stay intact', async ({ request, ctx }) => {
  const state = backupState(ctx)
  const user = requireLiveUser(state)
  const assetId = state.liveAssetId
  if (!assetId) throw new Error('upload a photo for the live backup user first')
  // the delete is S3-keys-only: the photo still reads and the account still lists
  expect((await getAsset(request, user, assetId)).id).toBe(assetId)
  const list = await request.get(`/api/v1/admin/users?q=${encodeURIComponent(user.user.email)}`, {
    headers: authHeaders(await requireAdmin(request, state)),
  })
  expect(list.status()).toBe(200)
  expect(((await list.json()) as { total: number }).total).toBe(1)
})

Then('a fresh backup recreates the live backup', async ({ request, ctx, $testInfo }) => {
  $testInfo.setTimeout(240_000)
  const state = backupState(ctx)
  const user = requireLiveUser(state)
  expect((await runBackup(request, state, user.user.id)).assets).toBe(1)
  const status = await fetchStatus(request, await requireAdmin(request, state), user.user.id)
  expect(status.exists).toBe(true)
  expect(status.assets).toBe(1)
})

When('I open the delete backup dialog for the orphan victim', async ({ page, ctx }) => {
  const email = requireVictim(backupState(ctx)).user.email
  await page.getByRole('button', { name: `Delete backup for ${email}`, exact: true }).click()
  await expect(deleteBackupDialog(page)).toBeVisible()
})

Then('the orphan delete dialog shows the prefix and counts', async ({ page, ctx }) => {
  const victim = requireVictim(backupState(ctx))
  const dialog = deleteBackupDialog(page)
  await expect(dialog.locator('code')).toContainText('backups/')
  await expect(dialog.locator('code')).toContainText(victim.user.id)
  await expect(dialog.getByText(/assets and/)).toBeVisible()
})

When('I confirm orphan backup deletion with typed DELETE', async ({ page, ctx }) => {
  await confirmTypedDeleteBackup(page, requireVictim(backupState(ctx)).user.email)
})

Then('the orphan backup row is gone and its status is missing', async ({ page, request, ctx }) => {
  const state = backupState(ctx)
  const victim = requireVictim(state)
  await searchBackups(page, victim.user.email)
  // the delete bumps the overview version and refetches: the manifest-less orphan drops out
  await expect(page.getByText(/No users match/)).toBeVisible({ timeout: 30_000 })
  const status = await request.get(
    `/api/v1/admin/backups/status?emailOrId=${encodeURIComponent(victim.user.id)}`,
    { headers: authHeaders(await requireAdmin(request, state)) },
  )
  expect(status.status()).toBe(200)
  expect(((await status.json()) as { exists: boolean }).exists).toBe(false)
})

Then('the orphan victim account stays deleted', async ({ request, ctx }) => {
  const state = backupState(ctx)
  const victim = requireVictim(state)
  const list = await request.get(`/api/v1/admin/users?q=${encodeURIComponent(victim.user.email)}`, {
    headers: authHeaders(await requireAdmin(request, state)),
  })
  expect(list.status()).toBe(200)
  expect(((await list.json()) as { total: number }).total).toBe(0)
})

When('I run backup-all from the backups tab', async ({ page, ctx, $testInfo }) => {
  // backup-all walks the filtered live rows serially — bound it with the search box below
  $testInfo.setTimeout(360_000)
  const state = backupState(ctx)
  const active = requireActiveUser(state)
  // Backup-all covers the filtered list, so narrow to this scenario's active user: the shared
  // instance holds every parallel scenario's users and backing all of them up is unbounded
  await searchBackups(page, active.user.email)
  const targets: string[] = []
  state.backupAllTargets = targets
  await page.route('**/api/v1/admin/backups', async (route) => {
    if (route.request().method() === 'POST') {
      try {
        const body = route.request().postDataJSON() as { emailOrId?: unknown } | null
        if (typeof body?.emailOrId === 'string') targets.push(body.emailOrId)
      } catch {
        // non-JSON bodies never carry a backup target — keep the spy counting
      }
    }
    await route.continue()
  })
  try {
    await page.getByRole('button', { name: 'Back up all users' }).click()
    await expect(page.getByRole('heading', { name: /Back up \d+ users?\?/ })).toBeVisible()
    // the toolbar button's "Back up all users" label can never exactly match the confirm
    await page.getByRole('button', { name: 'Back up all', exact: true }).click()
    await expect(page.getByText('Backup-all finished')).toBeVisible({ timeout: 300_000 })
  } finally {
    await page.unroute('**/api/v1/admin/backups')
  }
})

Then(
  'backup-all backs up the active user and skips the deleted orphan',
  async ({ request, ctx }) => {
    const state = backupState(ctx)
    const active = requireActiveUser(state)
    const gone = requireDeletedVictim(state)
    const calls = state.backupAllTargets ?? []
    expect(calls).toContain(active.user.id)
    expect(calls).not.toContain(gone.user.id)
    expect(calls).not.toContain(gone.user.email)
    // the orphan's manifest is untouched — same stamp as before backup-all ran
    const stamped = state.orphanBackupAt
    if (!stamped) throw new Error('back up the deleted orphan first')
    const status = await fetchStatus(request, await requireAdmin(request, state), gone.user.id)
    expect(status.exists).toBe(true)
    expect(status.backedUpAt).toBe(stamped)
  },
)
