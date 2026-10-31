import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  After,
  Given,
  PASSWORD,
  SIGNUPS_CLOSED_NOTICE,
  Then,
  When,
  authHeaders,
  injectSession,
  signInAdmin,
  type AuthResponse,
  type Ctx,
} from '../support';

// --- admin-created accounts ----------------------------------------------------------------
// POST /api/v1/admin/users is the only account path once public sign-ups are closed. The admin
// session comes from signInAdmin (support.ts) so the parallel `suite` workers share one login;
// every scenario registers its own unique email and narrows the users table to that row.
// Scenario 3 mocks the public flag on its own page — the real global switch is flipped only by
// the serial features/00-serial feature, because every parallel scenario registers users.

/** Wire row returned by POST /api/v1/admin/users (AdminUserRow). */
interface CreatedUserRow {
  id: string;
  displayName: string;
  email: string;
  role: 'user' | 'admin';
}

/** What the dialog is about to submit; also what the assertions look for. */
interface UserDraft {
  name: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
}

/** Per-scenario creation state, keyed by the scenario ctx (support.ts Ctx untouched). */
interface UserCreateState {
  admin?: AuthResponse;
  draft?: UserDraft;
  created?: CreatedUserRow;
  createStatus?: number;
}

const states = new WeakMap<Ctx, UserCreateState>();

function createState(ctx: Ctx): UserCreateState {
  let state = states.get(ctx);
  if (!state) {
    state = {};
    states.set(ctx, state);
  }
  return state;
}

function requireDraft(ctx: Ctx): UserDraft {
  const draft = createState(ctx).draft;
  if (!draft) throw new Error('describe the account to create first');
  return draft;
}

async function requireCreateAdmin(request: APIRequestContext, ctx: Ctx): Promise<AuthResponse> {
  const state = createState(ctx);
  state.admin ??= await signInAdmin(request);
  return state.admin;
}

function draftFor(name: string, role: 'user' | 'admin'): UserDraft {
  return { name, email: `created-${randomUUID()}@photox.test`, password: PASSWORD, role };
}

/** Narrows the users table to one row and waits for the search-scoped footer to settle. */
async function searchUsersFor(page: Page, email: string): Promise<void> {
  await page.getByLabel('Search users').fill(email);
  await expect(page.getByText('Showing 1 registered user(s)', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

function createUserDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Create user account' });
}

Given(
  'an administrator session is available for account creation',
  async ({ request, page, baseURL, ctx }) => {
    const admin = await requireCreateAdmin(request, ctx);
    ctx.auth = admin;
    await injectSession(page, admin, baseURL);
    await page.goto('/');
  },
);

Given('a regular account will be created through the dialog', ({ ctx }) => {
  createState(ctx).draft = draftFor('E2E Created User', 'user');
});

Given('an administrator account will be created through the dialog', ({ ctx }) => {
  createState(ctx).draft = draftFor('E2E Created Admin', 'admin');
});

Given('the public sign-up flag is mocked off for this page', async ({ page }) => {
  // page-scoped: never touches the real app_settings row that the rest of the run registers
  // against (the same interception pattern as the delete feature's delayed response)
  await page.route('**/api/v1/auth/registration', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false }),
    });
  });
});

Then('the login page hides the create-account link', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Create an account')).toHaveCount(0);
  await expect(page.getByText(/Don't have an account/)).toHaveCount(0);
});

Then('the register page shows the closed sign-up notice', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByText(SIGNUPS_CLOSED_NOTICE, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

When('the account-creating admin opens the users tab', async ({ page }) => {
  await page.goto('/admin?tab=users');
  await expect(page.getByRole('heading', { level: 2, name: 'Users Management' })).toBeVisible({
    timeout: 15_000,
  });
});

When('the account-creating admin opens the create-user dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'New user', exact: true }).click();
  await expect(createUserDialog(page)).toBeVisible();
});

Then('the create-user submit stays disabled until every field is valid', async ({ page, ctx }) => {
  const draft = requireDraft(ctx);
  const dialog = createUserDialog(page);
  const submit = dialog.getByRole('button', { name: 'Create user', exact: true });
  // empty name
  await expect(submit).toBeDisabled();
  await dialog.locator('#create-user-email').fill(draft.email);
  await dialog.locator('#create-user-password').fill(draft.password);
  await expect(submit).toBeDisabled();
  await dialog.locator('#create-user-name').fill(draft.name);
  await expect(submit).toBeEnabled();
  // malformed email
  await dialog.locator('#create-user-email').fill('not-an-email');
  await expect(dialog.getByText('Enter a valid email address.', { exact: true })).toBeVisible();
  await expect(submit).toBeDisabled();
  // password under the 8-character floor
  await dialog.locator('#create-user-email').fill(draft.email);
  await dialog.locator('#create-user-password').fill('short');
  await expect(dialog.getByText('Use at least 8 characters.', { exact: true })).toBeVisible();
  await expect(submit).toBeDisabled();
});

When('the account-creating admin submits the new account', async ({ page, ctx }) => {
  const state = createState(ctx);
  const draft = requireDraft(ctx);
  const dialog = createUserDialog(page);
  await dialog.locator('#create-user-name').fill(draft.name);
  await dialog.locator('#create-user-email').fill(draft.email);
  await dialog.locator('#create-user-password').fill(draft.password);
  await dialog.locator('#create-user-role').selectOption(draft.role);
  await expect(dialog.getByRole('button', { name: 'Create user', exact: true })).toBeEnabled();
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/admin/users',
    { timeout: 30_000 },
  );
  await dialog.getByRole('button', { name: 'Create user', exact: true }).click();
  const response = await pending;
  state.createStatus = response.status();
  state.created = (await response.json()) as CreatedUserRow;
});

Then('the admin account create request returned 201', ({ ctx }) => {
  expect(createState(ctx).createStatus).toBe(201);
});

Then('the create-user dialog closes with a Created toast', async ({ page, ctx }) => {
  const draft = requireDraft(ctx);
  // the toast auto-dismisses after ~3s, so assert it before anything else
  await expect(page.getByText(`Created ${draft.name}.`, { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(createUserDialog(page)).toHaveCount(0);
});

Then('the users row shows the created account with its role', async ({ page, ctx }) => {
  const draft = requireDraft(ctx);
  await searchUsersFor(page, draft.email);
  const row = page.locator('tbody tr').filter({ hasText: draft.email });
  await expect(row).toHaveCount(1);
  await expect(row.getByText(draft.name, { exact: true })).toBeVisible();
  await expect(row.getByText(draft.email, { exact: true })).toBeVisible();
  // RoleBadge renders the raw role value, lower-cased in the markup
  await expect(row.getByText(draft.role, { exact: true })).toBeVisible();
});

Then('the created account signs in as a regular user', async ({ request, ctx }) => {
  const draft = requireDraft(ctx);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: draft.email, password: draft.password },
  });
  expect(response.status()).toBe(200);
  const auth = (await response.json()) as AuthResponse;
  expect(auth.user.email).toBe(draft.email);
  expect(auth.user.role).toBe('user');
});

Then('the created admin can reach the admin users API', async ({ request, ctx }) => {
  const draft = requireDraft(ctx);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: draft.email, password: draft.password },
  });
  expect(response.status()).toBe(200);
  const auth = (await response.json()) as AuthResponse;
  expect(auth.user.role).toBe('admin');
  const list = await request.get('/api/v1/admin/users', { headers: authHeaders(auth) });
  expect(list.status()).toBe(200);
});

Then('the created admin account is removed again', async ({ request, ctx }) => {
  // a second admin left in the database would let feature 13's last-admin DELETE through (the
  // guard only counts role=admin rows), so the scenario must end with the seeded admin alone
  const state = createState(ctx);
  const created = state.created;
  if (!created) throw new Error('create the admin account first');
  const admin = await requireCreateAdmin(request, ctx);
  const response = await request.delete(`/api/v1/admin/users/${created.id}`, {
    headers: authHeaders(admin),
  });
  expect(response.status()).toBe(202);
  await expect
    .poll(
      async () => {
        const status = await request.get(`/api/v1/admin/users/${created.id}/delete-status`, {
          headers: authHeaders(admin),
        });
        if (status.status() !== 200) return `http-${status.status()}`;
        return ((await status.json()) as { state?: string }).state ?? 'missing';
      },
      { timeout: 60_000 },
    )
    .toBe('completed');
  state.created = undefined;
});

// Best-effort backstop for a scenario that fails before the removal step.
After(async ({ request, ctx, $testInfo }) => {
  const state = states.get(ctx);
  const created = state?.created;
  if (created?.role !== 'admin') return;
  try {
    const admin = state?.admin ?? (await signInAdmin(request));
    await request.delete(`/api/v1/admin/users/${created.id}`, { headers: authHeaders(admin) });
  } catch (err) {
    // never fail the hook — annotate so the leftover account is visible in the report
    $testInfo.annotations.push({
      type: 'warning',
      description: `could not remove the created admin account: ${String(err)}`,
    });
  }
});
