import {
  Then,
  When,
  expectSingleTimelineItem,
  expectThumbnailLoaded,
  uploadFixture,
  waitForThumbnails,
} from './support'

When('I upload {string}', async ({ page, ctx }, name: string) => {
  ctx.assetId = await uploadFixture(page, name)
})

Then('the timeline shows exactly one item', async ({ page }) => {
  await expectSingleTimelineItem(page)
})

Then('its thumbnail image finishes loading', async ({ page, request, ctx }) => {
  if (!ctx.assetId || !ctx.auth) throw new Error('upload an asset first')
  // the timeline fetches the asset before the worker registers thumbnails — refresh once ready
  await waitForThumbnails(request, ctx.auth, ctx.assetId, ['md'])
  await page.reload()
  await expectSingleTimelineItem(page)
  await expectThumbnailLoaded(page)
})
