import { expect, type APIRequestContext } from '@playwright/test';
import { Given, Then, When } from '../support';

Given('I am not signed in', () => {
  // fresh browser context per scenario: nothing persisted, no init script
});

When('I open {string}', async ({ page }, path: string) => {
  await page.goto(path);
});

Then('I am on the login page', async ({ page }) => {
  await expect(page).toHaveURL('/login');
  await expect(page.locator('#email')).toBeVisible();
});

async function callApi(
  request: APIRequestContext,
  spec: string,
  headers?: Record<string, string>,
): Promise<number> {
  const [method, path] = spec.split(' ');
  if (!method || !path) throw new Error(`invalid API call spec: "${spec}"`);
  const response = await request.fetch(path, { method, headers });
  return response.status();
}

When('an anonymous client calls {string}', async ({ request, ctx }, spec: string) => {
  ctx.lastStatus = await callApi(request, spec);
});

Then('the response status is {int}', ({ ctx }, status: number) => {
  expect(ctx.lastStatus).toBe(status);
});
