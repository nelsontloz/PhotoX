import { expect } from '@playwright/test'
import {
  Then,
  When,
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
  const firstAssetId = ctx.assetId
  // same-user re-uploads may resolve from the POST /api/v1/files/exists check and send NO
  // POST /api/v1/files (neither 201 nor 409); uploadFixture races both POSTs and returns the
  // existing asset id on either the skip or the 409 path.
  const existingAssetId = await uploadFixture(page, name, { allowDuplicate: true })
  // duplicate checksum: core points back at the SAME asset; the UI marks it done
  expect(existingAssetId).toBe(firstAssetId)
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
