import { expect, type Page } from '@playwright/test'
import {
  Given,
  PASSWORD,
  Then,
  When,
  authHeaders,
  injectSession,
  readSessionRole,
  registerUser,
} from './support'

interface PersistedAuthState {
  accessToken?: string | null
  refreshToken?: string | null
}

/**
 * Reads zustand's persisted `photox.auth` wrapper. `null` when the key is absent or unparseable —
 * logout rewrites the key with null tokens, so key existence alone proves nothing.
 */
async function readPersistedAuthState(page: Page): Promise<PersistedAuthState | null> {
  const raw = await page.evaluate(() => window.localStorage.getItem('photox.auth'))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { state?: PersistedAuthState }
    return parsed.state ?? null
  } catch {
    return null
  }
}

Given('the instance database is empty', () => {
  // enforced by e2e/run.sh: the stack starts from `docker compose down -v`
})

Given('I am signed in', async ({ request, page, ctx }) => {
  ctx.auth = await registerUser(request)
  await injectSession(page, ctx.auth)
  // land on the timeline so subsequent UI steps have a page to interact with
  await page.goto('/')
})

When('I register {string} through the register page', async ({ page }, email: string) => {
  await page.goto('/register')
  await page.fill('#fullName', 'E2E User')
  await page.fill('#email', email)
  await page.fill('#password', PASSWORD)
  await page.fill('#confirmPassword', PASSWORD)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page).toHaveURL('/')
})

Then('I am signed in on the timeline', async ({ page }) => {
  await expect(page).toHaveURL('/')
  expect(await readSessionRole(page)).toBeTruthy()
})

Then('my session role is {string}', async ({ page }, role: string) => {
  expect(await readSessionRole(page)).toBe(role)
})

Then('the sidebar shows the admin link', async ({ page }) => {
  await expect(page.locator('a[href="/admin"]')).toBeVisible()
})

Then('the sidebar does not show the admin link', async ({ page }) => {
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0)
})

Then('I can open the admin dashboard', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible({
    timeout: 15_000,
  })
})

When('I sign out', async ({ page }) => {
  await page.goto('/')
  // fresh contexts (feature 01 scenario 2) start signed out — only click when a session exists
  const state = await readPersistedAuthState(page)
  if (state?.refreshToken) {
    await page.locator('[title="Sign out"]').click()
  }
  await expect(page).toHaveURL('/login')
})

When('I open the timeline and sign out through the account menu', async ({ page }) => {
  await page.goto('/')
  const signOut = page.locator('[title="Sign out"]')
  await expect(signOut).toBeVisible()
  await signOut.click()
})

Then('the stored session has no refresh token', async ({ page }) => {
  const state = await readPersistedAuthState(page)
  if (state?.refreshToken != null) {
    throw new Error('the persisted session still holds a refresh token after sign-out')
  }
})

Then('the admin API accepts my session', async ({ page, request, ctx }) => {
  // UI-registered scenarios (feature 01) never populate ctx.auth — fall back to the browser's
  // persisted session, which is the token the app itself would send
  const accessToken = ctx.auth?.accessToken ?? (await readPersistedAuthState(page))?.accessToken
  if (!accessToken) throw new Error('no access token in ctx.auth or localStorage — sign in first')
  const headers = ctx.auth ? authHeaders(ctx.auth) : { Authorization: `Bearer ${accessToken}` }
  const response = await request.get('/api/v1/admin/users', { headers })
  expect(response.status()).toBe(200)
})

Then('the users table lists {string}', async ({ page }, email: string) => {
  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 })
})

Then('opening {string} redirects me to the timeline', async ({ page }, path: string) => {
  await page.goto(path)
  await expect(page).toHaveURL('/')
})
