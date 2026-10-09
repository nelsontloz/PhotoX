import { join } from 'node:path'
import { expect } from '@playwright/test'
import {
  Then,
  When,
  FIXTURES_DIR,
  expectSingleTimelineItem,
  expectThumbnailLoaded,
  uploadFixture,
  waitForThumbnails,
} from '../support'

When('I upload {string}', async ({ page, ctx }, name: string) => {
  ctx.assetId = await uploadFixture(page, name)
})

Then('the timeline shows exactly one item', async ({ page }) => {
  await expectSingleTimelineItem(page)
})

When('I upload {string} again', async ({ page, ctx }, name: string) => {
  if (!ctx.assetId) throw new Error('upload the file once before uploading it again')
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/files',
    ),
    page.locator('input[type="file"]').first().setInputFiles(join(FIXTURES_DIR, name)),
  ])
  // duplicate checksum: core answers 409 pointing back at the SAME asset; the UI marks it done
  expect(response.status()).toBe(409)
  const body = (await response.json()) as { existingAssetId?: string; existingFileId?: string }
  expect(body.existingAssetId).toBe(ctx.assetId)
  expect(body.existingFileId).toBeTruthy()
  // the UI must accept the duplicate, not surface it: UploadNotification.tsx shows
  // "All 2 items uploaded" only when no item errored — an error-mapped 409 would read
  // "1 uploads failed"
  await expect(page.getByText('All 2 items uploaded')).toBeVisible()
})

Then('its thumbnail image finishes loading', async ({ page, request, ctx }) => {
  if (!ctx.assetId || !ctx.auth) throw new Error('upload an asset first')
  // the timeline fetches the asset before the worker registers thumbnails — refresh once ready
  await waitForThumbnails(request, ctx.auth, ctx.assetId, ['md'])
  await page.reload()
  await expectSingleTimelineItem(page)
  await expectThumbnailLoaded(page)
})
