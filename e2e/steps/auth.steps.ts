import { expect } from '@playwright/test'
import {
  Given,
  PASSWORD,
  Then,
  When,
  injectSession,
  readSessionRole,
  registerUser,
} from './support'

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
  const signedIn = await page.evaluate(() => window.localStorage.getItem('photox.auth') !== null)
  if (signedIn) {
    await page.locator('[title="Sign out"]').click()
  }
  await expect(page).toHaveURL('/login')
})

Then('opening {string} redirects me to the timeline', async ({ page }, path: string) => {
  await page.goto(path)
  await expect(page).toHaveURL('/')
})
