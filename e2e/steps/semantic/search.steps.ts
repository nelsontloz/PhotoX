import { expect } from '@playwright/test';
import { Then, When, openViewerAndCaptureAssetId } from '../support';

When('I open the first photo in the viewer', async ({ page, ctx }) => {
  await page.goto('/');
  await openViewerAndCaptureAssetId(page, ctx);
});

Then('the related tray offers similar photos', async ({ page }) => {
  // related assets are fetched after the viewer opens, slower than the default 15s expect timeout
  await expect(page.getByRole('button', { name: 'More like this' })).toBeVisible({
    timeout: 60_000,
  });
});

When('I expand the similar photos', async ({ page }) => {
  await page.getByRole('button', { name: 'More like this' }).click();
});

Then('the tray lists the similar photo count', async ({ page }) => {
  await expect(page.getByText(/similar photos?/)).toBeVisible();
});
