import { expect, type APIRequestContext } from '@playwright/test'
import {
  Then,
  When,
  type AuthState,
  discoverAssetId,
  expectSingleTimelineItem,
  expectThumbnailLoaded,
  getAsset,
  waitForThumbnails,
} from './support'

/** Polls until transcode reaches a terminal state, so a 'failed' result fails fast. */
async function waitForTranscodeStatus(
  request: APIRequestContext,
  auth: AuthState,
  id: string,
  status: string,
): Promise<void> {
  const terminal = async () => {
    const current = (await getAsset(request, auth, id)).transcodeStatus
    return current === 'ready' || current === 'failed' ? current : 'pending'
  }
  await expect.poll(terminal, { timeout: 180_000 }).not.toBe('pending')
  expect(await terminal()).toBe(status)
}

Then(
  'the video asset reaches transcode status {string} with a transcode file',
  async ({ page, request, ctx }, status: string) => {
    const id = await discoverAssetId(page, ctx)
    if (!ctx.auth) throw new Error('ctx.auth is missing — sign in first')
    const auth = ctx.auth
    await waitForTranscodeStatus(request, auth, id, status)
    expect((await getAsset(request, auth, id)).transcodeFileId).toBeTruthy()
  },
)

Then(
  'the video asset reaches transcode status {string} without a transcode file',
  async ({ page, request, ctx }, status: string) => {
    const id = await discoverAssetId(page, ctx)
    if (!ctx.auth) throw new Error('ctx.auth is missing — sign in first')
    const auth = ctx.auth
    await waitForTranscodeStatus(request, auth, id, status)
    expect((await getAsset(request, auth, id)).transcodeFileId).toBeFalsy()
  },
)

Then('the timeline shows its loaded thumbnail', async ({ page, request, ctx }) => {
  if (!ctx.assetId || !ctx.auth) throw new Error('upload an asset first')
  await waitForThumbnails(request, ctx.auth, ctx.assetId, ['md'])
  await page.goto('/')
  await expectSingleTimelineItem(page)
  await expectThumbnailLoaded(page)
})

When('I open the video viewer for that asset', async ({ page, ctx }) => {
  if (!ctx.assetId) throw new Error('ctx.assetId is missing — read the transcode status first')
  await page.goto(`/?asset=${ctx.assetId}`)
  await expect(page.locator('video[aria-label^="Video player"]')).toBeVisible()
})

Then('the video element becomes playable', async ({ page }) => {
  const video = page.locator('video[aria-label^="Video player"]')
  // preload="metadata" can stop at readyState 1 until playback starts — metadata + a decodable
  // video track (videoWidth > 0) is the strongest signal short of pressing play
  await expect
    .poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1)
  expect(await video.evaluate((el) => (el as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
})

Then('playback advances past 0.2 seconds', async ({ page }) => {
  const video = page.locator('video[aria-label^="Video player"]')
  await video.click()
  await expect
    .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime), { timeout: 15_000 })
    .toBeGreaterThan(0.2)
  expect(await video.evaluate((el) => (el as HTMLVideoElement).paused)).toBe(false)
})
