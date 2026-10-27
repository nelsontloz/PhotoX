import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  After,
  Given,
  PASSWORD,
  SIGNUPS_CLOSED_NOTICE,
  Then,
  When,
  authHeaders,
  injectSession,
  signInAdmin,
  type AuthResponse,
  type Ctx,
} from '../support'

// --- public sign-up switch ----------------------------------------------------------------
// The real `registration.enabled` row is global: flipping it here is only safe because this
// feature lives in the serial `setup` project, before every parallel scenario registers users.
// The After hook restores it, so a mid-scenario failure cannot poison 04-faces, 05-semantic or
// the whole parallel suite.

const REGISTRATION_PATH = '/api/v1/admin/registration'
const SWITCH_LABEL = 'Allow public sign-ups'

/** Per-scenario toggle state, keyed by the scenario ctx (support.ts Ctx untouched). */
interface ToggleState {
  admin?: AuthResponse
  /** Set before the PATCH that closes sign-ups, so the After hook knows to restore them. */
  mayBeOff?: boolean
}

const states = new WeakMap<Ctx, ToggleState>()

function toggleState(ctx: Ctx): ToggleState {
  let state = states.get(ctx)
  if (!state) {
    state = {}
    states.set(ctx, state)
  }
  return state
}

async function requireToggleAdmin(request: APIRequestContext, ctx: Ctx): Promise<AuthResponse> {
  const state = toggleState(ctx)
  state.admin ??= await signInAdmin(request)
  return state.admin
}

function switchControl(page: Page) {
  return page.getByRole('switch', { name: SWITCH_LABEL })
}

async function openUsersTab(page: Page) {
  await page.goto('/admin?tab=users')
  await expect(page.getByRole('heading', { level: 2, name: 'Users Management' })).toBeVisible({
    timeout: 15_000,
  })
}

/** Clicks the switch once and waits for its PATCH, so the assertion never races the save. */
async function flipSwitch(page: Page, enabled: boolean): Promise<void> {
  const control = switchControl(page)
  await expect(control).toBeVisible({ timeout: 15_000 })
  await expect(control).toHaveAttribute('aria-checked', String(!enabled))
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === REGISTRATION_PATH,
    { timeout: 30_000 },
  )
  await control.click()
  expect((await pending).status()).toBe(200)
  await expect(control).toHaveAttribute('aria-checked', String(enabled))
}

Given(
  'an administrator session is available for the sign-up switch',
  async ({ request, page, baseURL, ctx }) => {
    const admin = await requireToggleAdmin(request, ctx)
    ctx.auth = admin
    await injectSession(page, admin, baseURL)
    await page.goto('/')
  },
)

When('the sign-up-switch admin opens the users tab', async ({ page }) => {
  await openUsersTab(page)
})

When('the sign-up-switch admin turns public sign-ups off', async ({ page, ctx }) => {
  // flag the intent BEFORE the request: a failure after the PATCH still leaves it off
  toggleState(ctx).mayBeOff = true
  await flipSwitch(page, false)
})

Then('the sign-up switch reads off and stays off after a reload', async ({ page }) => {
  await expect(switchControl(page)).toHaveAttribute('aria-checked', 'false')
  // the switch only renders once the settings fetch has landed, so a reload proves the stored
  // row, not the optimistic flip
  await page.reload()
  const control = switchControl(page)
  await expect(control).toBeEnabled({ timeout: 15_000 })
  await expect(control).toHaveAttribute('aria-checked', 'false')
})

Then('the public registration endpoint reports sign-ups closed', async ({ request }) => {
  const response = await request.get('/api/v1/auth/registration')
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ enabled: false })
})

Then('an anonymous registration is refused with 403', async ({ request }) => {
  const response = await request.post('/api/v1/auth/register', {
    data: {
      email: `closed-${randomUUID()}@photox.test`,
      password: PASSWORD,
      displayName: 'E2E Closed Sign-up',
    },
  })
  expect(response.status()).toBe(403)
})

Then(
  'the admin can still create an account while sign-ups are closed',
  async ({ request, ctx }) => {
    const admin = await requireToggleAdmin(request, ctx)
    const email = `admin-created-${randomUUID()}@photox.test`
    const response = await request.post('/api/v1/admin/users', {
      headers: authHeaders(admin),
      data: { displayName: 'E2E Created While Closed', email, password: PASSWORD },
    })
    expect(response.status()).toBe(201)
    const body = (await response.json()) as { email: string; role: string }
    expect(body.email).toBe(email)
    expect(body.role).toBe('user')
  },
)

Then(
  'a fresh visitor sees no create-account link and a closed register page',
  async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('baseURL is required for an anonymous page')
    // the signed-in `page` fixture redirects off /login and /register, so probe in a throwaway
    // anonymous context that is closed again right after
    const context = await browser.newContext({ baseURL })
    try {
      const anonymous = await context.newPage()
      await anonymous.goto('/login')
      await expect(anonymous.getByRole('button', { name: 'Sign In' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(anonymous.getByText('Create an account')).toHaveCount(0)
      await expect(anonymous.getByText(/Don't have an account/)).toHaveCount(0)
      await anonymous.goto('/register')
      await expect(anonymous.getByText(SIGNUPS_CLOSED_NOTICE, { exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await expect(anonymous.locator('form')).toHaveCount(0)
      await expect(anonymous.getByRole('link', { name: 'Sign in' })).toBeVisible()
    } finally {
      await context.close()
    }
  },
)

When('the sign-up-switch admin turns public sign-ups back on', async ({ page, ctx }) => {
  await flipSwitch(page, true)
  toggleState(ctx).mayBeOff = false
})

Then('the login page offers the create-account link again', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('baseURL is required for an anonymous page')
  const context = await browser.newContext({ baseURL })
  try {
    const anonymous = await context.newPage()
    await anonymous.goto('/login')
    await expect(anonymous.getByRole('link', { name: 'Create an account' })).toBeVisible({
      timeout: 15_000,
    })
  } finally {
    await context.close()
  }
})

Then('an anonymous registration succeeds again', async ({ request }) => {
  const response = await request.post('/api/v1/auth/register', {
    data: {
      email: `reopened-${randomUUID()}@photox.test`,
      password: PASSWORD,
      displayName: 'E2E Reopened Sign-up',
    },
  })
  expect(response.status()).toBe(201)
})

// SAFETY NET: the parallel suite registers users constantly, so a scenario that dies between the
// off-flip and the on-flip must never leave the global flag closed. Never fails the hook itself.
After(async ({ request, ctx, $testInfo }) => {
  if (!toggleState(ctx).mayBeOff) return
  try {
    const admin = toggleState(ctx).admin ?? (await signInAdmin(request))
    const response = await request.patch(REGISTRATION_PATH, {
      headers: authHeaders(admin),
      data: { enabled: true },
    })
    if (response.status() !== 200) throw new Error(`PATCH answered ${response.status()}`)
  } catch (err) {
    $testInfo.annotations.push({
      type: 'warning',
      description: `public sign-ups were not restored: ${String(err)}`,
    })
  }
})
