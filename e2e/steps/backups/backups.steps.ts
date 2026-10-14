import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type APIRequestContext } from '@playwright/test'
import {
  Given,
  Then,
  When,
  PASSWORD,
  authHeaders,
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
    await expect(page.locator('table')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back up all' })).toBeVisible()
  },
)
