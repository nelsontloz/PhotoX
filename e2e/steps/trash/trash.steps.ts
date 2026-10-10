import { expect, type Page } from '@playwright/test'
import { Given, Then, When, authHeaders, requireAuth, uploadViaApi, type Ctx } from '../support'

function requireOpenTrashedId(ctx: Ctx): string {
  const id = ctx.openTrashedId
  if (!id) throw new Error('open a trashed item in the viewer first')
  return id
}

const trashFigure = (page: Page) => page.locator('figure[role="button"]')

Given('I uploaded two photos through the API', async ({ request, ctx }) => {
  const auth = requireAuth(ctx)
  const first = await uploadViaApi(request, auth, 'photo.jpg')
  const second = await uploadViaApi(request, auth, 'photo-text.jpg')
  ctx.trashAssetIds = [first, second]
  ctx.assetId = first
})

When('I trash the uploaded asset through the API', async ({ request, ctx }) => {
  if (!ctx.assetId) throw new Error('upload a photo first')
  const response = await request.post(`/api/v1/assets/${ctx.assetId}/trash`, {
    headers: authHeaders(requireAuth(ctx)),
  })
  expect(response.status()).toBe(204)
})

When('I trash both uploaded photos through the API', async ({ request, ctx }) => {
  const assetIds = ctx.trashAssetIds
  if (!assetIds) throw new Error('upload the two photos first')
  const response = await request.post('/api/v1/assets/bulk-trash', {
    headers: authHeaders(requireAuth(ctx)),
    data: { assetIds },
  })
  expect(response.status()).toBe(204)
})

Then('the trash page shows exactly one item', async ({ page }) => {
  await expect(trashFigure(page)).toHaveCount(1, { timeout: 60_000 })
})

Then('the trash page shows exactly two items', async ({ page }) => {
  await expect(trashFigure(page)).toHaveCount(2, { timeout: 60_000 })
})

When('I restore the photo from the viewer', async ({ page, ctx }) => {
  if (!ctx.assetId) throw new Error('upload a photo first')
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/v1/assets/trashed/${ctx.assetId}/restore`,
    ),
    page.locator('button[aria-label="Restore from trash"]:visible').click(),
  ])
  expect(response.status()).toBe(204)
  await expect(page.locator('div.fixed.inset-0.z-50')).toHaveCount(0)
})

Then('the trash is empty', async ({ page }) => {
  await expect(page.getByText('Trash is empty')).toBeVisible()
  await expect(trashFigure(page)).toHaveCount(0)
})

When('I open the first trashed item in the viewer', async ({ page, ctx }) => {
  await trashFigure(page).first().click()
  await expect(page).toHaveURL(/[?&]asset=/)
  const id = new URL(page.url()).searchParams.get('asset')
  if (!id) throw new Error('no ?asset= id in the URL after opening the viewer')
  ctx.openTrashedId = id
  await expect(page.locator('div.fixed.inset-0.z-50')).toBeVisible()
})

When('I permanently delete the open photo from the viewer', async ({ page, ctx }) => {
  const id = requireOpenTrashedId(ctx)
  await page.locator('button[aria-label="Permanently delete"]:visible').click()
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' &&
        new URL(r.url()).pathname === `/api/v1/assets/trashed/${id}`,
    ),
    page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click(),
  ])
  expect(response.status()).toBe(200)
  await expect(page.locator('div.fixed.inset-0.z-50')).toHaveCount(0)
})

Then('the permanently deleted photo is gone through the API', async ({ request, ctx }) => {
  const response = await request.get(`/api/v1/assets/${requireOpenTrashedId(ctx)}`, {
    headers: authHeaders(requireAuth(ctx)),
  })
  expect(response.status()).toBe(404)
})

When('I empty the trash', async ({ page }) => {
  await page.getByRole('button', { name: 'Empty trash', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' && new URL(r.url()).pathname === '/api/v1/assets/trashed',
    ),
    page.getByRole('dialog').getByRole('button', { name: 'Empty trash', exact: true }).click(),
  ])
  expect(response.status()).toBe(200)
})
