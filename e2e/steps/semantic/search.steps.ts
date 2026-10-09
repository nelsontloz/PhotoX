import { expect } from '@playwright/test'
import { Then, When } from '../support'

/**
 * One of three terminal search states must appear: the 503 "index not ready" error (the alpine
 * core image has no glibc loader for onnxruntime-node), an empty result set, or the results
 * heading — so the scenario passes on both the bare e2e stack and a model-provisioned one.
 */
Then(
  'the search page shows a ready, empty, or not-ready state for {string}',
  async ({ page }, q: string) => {
    const states = [
      page.getByText('Search is not ready yet'),
      page.getByRole('heading', { name: new RegExp(`No results for .${q}.`) }),
      page.getByRole('heading', { name: new RegExp(`Results for .${q}.`) }),
    ]
    await expect
      .poll(
        async () => {
          const visible = await Promise.all(states.map((state) => state.isVisible()))
          return visible.some(Boolean)
        },
        { timeout: 20_000, message: `the search page never settled for "${q}"` },
      )
      .toBe(true)
  },
)

When('I open the first photo in the viewer', async ({ page, ctx }) => {
  await page.goto('/')
  await page.locator('figure[role="button"]').first().click()
  await expect(page).toHaveURL(/[?&]asset=/)
  const id = new URL(page.url()).searchParams.get('asset')
  if (!id) throw new Error('no ?asset= id in the URL after opening the viewer')
  ctx.assetId = id
})

Then('the related tray offers similar photos', async ({ page }) => {
  // related assets are fetched after the viewer opens, slower than the default 15s expect timeout
  await expect(page.getByRole('button', { name: 'More like this' })).toBeVisible({
    timeout: 60_000,
  })
})

When('I expand the similar photos', async ({ page }) => {
  await page.getByRole('button', { name: 'More like this' }).click()
})

Then('the tray lists the similar photo count', async ({ page }) => {
  await expect(page.getByText(/similar photos?/)).toBeVisible()
})
