import { expect } from '@playwright/test'
import {
  Given,
  Then,
  When,
  expectSingleTimelineItem,
  uploadFixture,
  waitForThumbnails,
} from './support'

Given('I uploaded {string}', async ({ page, request, ctx }, name: string) => {
  ctx.assetId = await uploadFixture(page, name)
  await expectSingleTimelineItem(page)
  if (!ctx.auth) throw new Error('sign in first')
  // wait for the sizes the grid (md) and the viewer (xl) need, then refresh the timeline
  await waitForThumbnails(request, ctx.auth, ctx.assetId, ['md', 'xl'])
  await page.reload()
  await expectSingleTimelineItem(page)
})

When('I click the photo thumbnail', async ({ page, ctx }) => {
  const previousId = ctx.assetId
  await page.locator('figure[role="button"]').first().click()
  await expect(page).toHaveURL(/[?&]asset=/)
  const id = new URL(page.url()).searchParams.get('asset')
  if (!id) throw new Error('no ?asset= id in the URL after opening the viewer')
  // the viewer must be showing the asset uploaded earlier, not some other tile
  if (previousId) expect(id).toBe(previousId)
  ctx.assetId = id
})

Then('the viewer is open on that photo', async ({ page }) => {
  const overlay = page.locator('div.fixed.inset-0.z-50')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByRole('heading', { level: 3, name: 'photo.jpg' })).toBeVisible()
})

Then('the large preview is loaded', async ({ page }) => {
  const img = page.locator('div.fixed.inset-0.z-50 img[alt="photo.jpg"]').first()
  await expect(img).toBeVisible()
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  // pickViewerThumb prefers xl (800px for the 800x600 fixture) and only falls back to
  // thumbnails[0] (md, 300px): width > md proves the full-size preview loaded, not the fallback
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(300)
})

When('I press Escape', async ({ page }) => {
  await page.keyboard.press('Escape')
})

Then('the viewer is closed and the timeline is visible', async ({ page }) => {
  await expect(page.locator('div.fixed.inset-0.z-50')).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]asset=/)
  await expect(page.locator('figure[role="button"]').first()).toBeVisible()
})
