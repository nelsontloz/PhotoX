import { expect } from '@playwright/test'
import { Then, When, authHeaders, requireAuth } from '../support'

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
  // The signed-in admin's timeline also holds other scenarios' uploads, and "newest first" may not
  // be this scenario's photo: deep-link the asset this scenario uploaded instead of clicking the
  // first tile.
  const target = ctx.semanticUploads?.[0]?.assetId ?? ctx.assetId
  if (!target) throw new Error('upload a photo first')
  await page.goto(`/?asset=${target}`)
  await expect(page.locator('div.fixed.inset-0.z-50')).toBeVisible({ timeout: 30_000 })
  ctx.assetId = target
})

Then('the related tray offers similar photos', async ({ page, request, ctx }) => {
  const auth = requireAuth(ctx)
  const target = ctx.assetId
  if (!target) throw new Error('open a photo first')

  // The tray is empty whenever the index has no row for the open photo — including while a
  // reprocess run elsewhere in the suite is rebuilding embeddings. Wait for the index, then
  // reopen the viewer so the tray's one-shot fetch actually sees it.
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/assets/${target}/similar`, {
          headers: authHeaders(auth),
        })
        if (response.status() === 404) {
          throw new Error(`the open asset ${target} was deleted mid-scenario`)
        }
        expect(response.status()).toBe(200)
        return ((await response.json()) as { total?: number }).total ?? 0
      },
      { timeout: 120_000, message: 'no similar assets were ever indexed for the open photo' },
    )
    .toBeGreaterThan(0)

  await page.reload()
  await expect(page.getByRole('button', { name: 'More like this' })).toBeVisible({
    timeout: 30_000,
  })
})

When('I expand the similar photos', async ({ page }) => {
  await page.getByRole('button', { name: 'More like this' }).click()
})

Then('the tray lists the similar photo count', async ({ page }) => {
  await expect(page.getByText(/similar photos?/)).toBeVisible()
})
