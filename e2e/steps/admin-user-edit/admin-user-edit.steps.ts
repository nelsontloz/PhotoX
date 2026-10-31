import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  Given,
  Then,
  When,
  PASSWORD,
  authHeaders,
  injectSession,
  registerUser,
  signIn,
  signInAdmin,
  type AuthResponse,
  type Ctx,
} from '../support';

// --- admin account edits -----------------------------------------------------------------
// The admin session comes from signInAdmin (support.ts) so the parallel `suite` workers
// share one login; every scenario registers its own account and every UI action first
// narrows the users table to that one row. The edit dialog talks to PATCH
// /api/v1/admin/users/:id, whose backup-sync outcome drives either the success toast or
// the persistent warning box under the table.

/** The name an edited account switches to; only ever asserted on the filtered single row. */
const EDITED_DISPLAY_NAME = 'E2E Edited User';
/** Mocked storage failure for the retry path — never a real S3 outage dependency. */
const STORAGE_ERROR = 'S3 unreachable';

/** Trimmed wire shape of PATCH /api/v1/admin/users/:id (see AdminUserUpdateResponse). */
interface AdminUserUpdateBody {
  user: {
    id: string;
    displayName: string;
    email: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
  backup: {
    synced: boolean;
    moved: boolean;
    from?: string;
    to: string;
    reason?: string;
    error?: string;
  };
}

/** Per-scenario edit state, keyed by the scenario ctx (support.ts Ctx untouched). */
interface UserEditState {
  admin?: AuthResponse;
  account?: AuthResponse;
  newName?: string;
  newEmail?: string;
  updateBody?: AdminUserUpdateBody;
  roleChangeStatus?: number;
}

const states = new WeakMap<Ctx, UserEditState>();

function editState(ctx: Ctx): UserEditState {
  let state = states.get(ctx);
  if (!state) {
    state = {};
    states.set(ctx, state);
  }
  return state;
}

function requireAccount(ctx: Ctx): AuthResponse {
  const account = editState(ctx).account;
  if (!account) throw new Error('register the account for the edit flow first');
  return account;
}

function requireNewEmail(ctx: Ctx): string {
  const email = editState(ctx).newEmail;
  if (!email) throw new Error('save the account edit first');
  return email;
}

function requireUpdateBody(ctx: Ctx): AdminUserUpdateBody {
  const body = editState(ctx).updateBody;
  if (!body) throw new Error('change the email through the admin API first');
  return body;
}

async function requireEditAdmin(request: APIRequestContext, ctx: Ctx): Promise<AuthResponse> {
  const state = editState(ctx);
  state.admin ??= await signInAdmin(request);
  return state.admin;
}

/** `<local>-edited@<domain>` — unique per scenario and derived from the registered address. */
function editedEmail(email: string): string {
  const at = email.indexOf('@');
  return at < 0 ? `${email}-edited` : `${email.slice(0, at)}-edited${email.slice(at)}`;
}

/** Narrows the users table to one row and waits for the search-scoped footer to settle. */
async function searchUsersFor(page: Page, email: string): Promise<void> {
  await page.getByLabel('Search users').fill(email);
  await expect(page.getByText('Showing 1 registered user(s)', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

function editDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Edit user account' });
}

async function openEditDialog(page: Page, displayName: string) {
  await page.getByRole('button', { name: `Edit ${displayName}`, exact: true }).click();
  const dialog = editDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

Given(
  'an administrator session is available for account editing',
  async ({ request, page, baseURL, ctx }) => {
    const admin = await requireEditAdmin(request, ctx);
    ctx.auth = admin;
    await injectSession(page, admin, baseURL);
    await page.goto('/');
  },
);

Given('a regular account is registered for the edit flow', async ({ request, ctx }) => {
  editState(ctx).account = await registerUser(request);
});

Given(
  'that account has an S3 backup taken through the admin API',
  async ({ request, ctx, $testInfo }) => {
    $testInfo.setTimeout(360_000);
    const admin = await requireEditAdmin(request, ctx);
    const response = await request.post('/api/v1/admin/backups', {
      headers: authHeaders(admin),
      data: { emailOrId: requireAccount(ctx).user.id },
    });
    expect(response.status()).toBe(200);
  },
);

When('the account-editing admin opens the users tab', async ({ page }) => {
  await page.goto('/admin?tab=users');
  await expect(page.getByRole('heading', { level: 2, name: 'Users Management' })).toBeVisible({
    timeout: 15_000,
  });
});

When(
  'the account-editing admin searches the users list for that account',
  async ({ page, ctx }) => {
    await searchUsersFor(page, requireAccount(ctx).user.email);
  },
);

Then('the users table offers an enabled Edit action for that account', async ({ page, ctx }) => {
  const account = requireAccount(ctx);
  const edit = page.getByRole('button', { name: `Edit ${account.user.displayName}`, exact: true });
  await expect(edit).toHaveCount(1);
  await expect(edit).toBeEnabled();
  expect(await edit.getAttribute('title')).toBe(`Edit ${account.user.displayName}`);
});

When('the account-editing admin opens the edit dialog for that account', async ({ page, ctx }) => {
  await openEditDialog(page, requireAccount(ctx).user.displayName);
});

Then(
  "the edit dialog is prefilled with the account's current name and email and an empty password field",
  async ({ page, ctx }) => {
    const account = requireAccount(ctx);
    const dialog = editDialog(page);
    await expect(
      dialog.getByRole('heading', { name: `Edit ${account.user.displayName}` }),
    ).toBeVisible();
    await expect(dialog.locator('#edit-user-name')).toHaveValue(account.user.displayName);
    await expect(dialog.locator('#edit-user-email')).toHaveValue(account.user.email);
    await expect(dialog.locator('#edit-user-password')).toHaveValue('');
  },
);

When(
  'the account-editing admin saves a new name and email for that account',
  async ({ page, ctx }) => {
    const account = requireAccount(ctx);
    const state = editState(ctx);
    state.newName = EDITED_DISPLAY_NAME;
    state.newEmail = editedEmail(account.user.email);
    await searchUsersFor(page, account.user.email);
    const dialog = await openEditDialog(page, account.user.displayName);
    await dialog.locator('#edit-user-name').fill(state.newName);
    await dialog.locator('#edit-user-email').fill(state.newEmail);
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    // the dialog closes only on success; the list refetches behind it
    await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  },
);

Then('the edit dialog closes after a successful save', async ({ page }) => {
  await expect(editDialog(page)).toHaveCount(0);
});

Then('the account edit toast reports the new name', async ({ page, ctx }) => {
  const name = editState(ctx).newName;
  if (!name) throw new Error('save the new name first');
  // the fresh account has no S3 backup, so the toast carries the no-backup note
  await expect(
    page.getByText(`Updated ${name}. No S3 backup found, so nothing was moved.`, { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
});

Then('the users list shows the updated name and email', async ({ page, ctx }) => {
  const state = editState(ctx);
  if (!state.newName || !state.newEmail) {
    throw new Error('save the updated name and email first');
  }
  await searchUsersFor(page, state.newEmail);
  const row = page.locator('tbody tr').filter({ hasText: state.newEmail });
  await expect(row).toHaveCount(1);
  await expect(row.getByText(state.newName, { exact: true })).toBeVisible();
  await expect(row.getByText(state.newEmail, { exact: true })).toBeVisible();
});

When(
  "the account-editing admin changes that account's email through the admin API",
  async ({ request, ctx }) => {
    const admin = await requireEditAdmin(request, ctx);
    const account = requireAccount(ctx);
    const state = editState(ctx);
    const newEmail = editedEmail(account.user.email);
    state.newEmail = newEmail;
    // the admin-set address is stored normalized: send mixed case, expect the lowercase form
    const mixedCase = newEmail.charAt(0).toUpperCase() + newEmail.slice(1);
    const response = await request.patch(`/api/v1/admin/users/${account.user.id}`, {
      headers: authHeaders(admin),
      data: { email: mixedCase },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as AdminUserUpdateBody;
    state.updateBody = body;
    expect(body.user.id).toBe(account.user.id);
    expect(body.user.email).toBe(newEmail);
  },
);

Then('the edited account signs in with the new address', async ({ request, ctx }) => {
  const account = requireAccount(ctx);
  const auth = await signIn(request, requireNewEmail(ctx));
  expect(auth.user.id).toBe(account.user.id);
});

Then('the old address no longer signs in', async ({ request, ctx }) => {
  const login = await request.post('/api/v1/auth/login', {
    data: { email: requireAccount(ctx).user.email, password: PASSWORD },
  });
  expect(login.status(), 'the old address should be rejected').toBe(401);
});

Then('the edit response reports no backup to move', ({ ctx }) => {
  const backup = requireUpdateBody(ctx).backup;
  expect(backup.moved).toBe(false);
  expect(backup.reason).toBe('no-backup');
});

When(
  "the account-editing admin changes that account's email through the edit dialog",
  async ({ page, ctx, $testInfo }) => {
    $testInfo.setTimeout(360_000);
    const account = requireAccount(ctx);
    const state = editState(ctx);
    const newEmail = editedEmail(account.user.email);
    state.newEmail = newEmail;
    await searchUsersFor(page, account.user.email);
    const dialog = await openEditDialog(page, account.user.displayName);
    await dialog.locator('#edit-user-email').fill(newEmail);
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    // an email change relocates the S3 backup inline, so the dialog stays up until it lands
    await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  },
);

Then('the account edit toast confirms the S3 backup moved', async ({ page, ctx }) => {
  const account = requireAccount(ctx);
  await expect(
    page.getByText(`Updated ${account.user.displayName}. S3 backup moved to the new address.`, {
      exact: true,
    }),
  ).toBeVisible({ timeout: 10_000 });
});

Then(
  "the account's S3 backup is reported at the new address",
  async ({ request, ctx, $testInfo }) => {
    $testInfo.setTimeout(360_000);
    const admin = await requireEditAdmin(request, ctx);
    const account = requireAccount(ctx);
    const response = await request.get(
      `/api/v1/admin/backups/status?emailOrId=${encodeURIComponent(account.user.id)}`,
      { headers: authHeaders(admin) },
    );
    expect(response.status()).toBe(200);
    const status = (await response.json()) as {
      exists: boolean;
      emailAtBackup?: string;
      backedUpAt?: string;
    };
    expect(status.exists).toBe(true);
    expect(status.emailAtBackup).toBe(requireNewEmail(ctx));
  },
);

When(
  'the account-editing admin triggers a failed backup move for that account',
  async ({ page, ctx, $testInfo }) => {
    $testInfo.setTimeout(360_000);
    const account = requireAccount(ctx);
    const state = editState(ctx);
    const newEmail = editedEmail(account.user.email);
    state.newEmail = newEmail;
    await searchUsersFor(page, account.user.email);
    const dialog = await openEditDialog(page, account.user.displayName);
    await dialog.locator('#edit-user-email').fill(newEmail);
    // answer the PATCH with a storage failure so the warning box is exercised without a
    // real S3 outage (same interception pattern as the delete feature's delayed response)
    await page.route('**/api/v1/admin/users/**', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: account.user.id,
            displayName: account.user.displayName,
            email: newEmail,
            role: account.user.role,
            createdAt: account.user.createdAt,
            updatedAt: new Date().toISOString(),
          },
          backup: {
            synced: false,
            moved: false,
            to: `backups/${newEmail}__${account.user.id}/`,
            error: STORAGE_ERROR,
          },
        }),
      });
    });
    try {
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
      // the account edit stands and the dialog closes; the failed move lives on in the box
      await expect(page.getByRole('alert')).toContainText(STORAGE_ERROR, { timeout: 30_000 });
    } finally {
      await page.unroute('**/api/v1/admin/users/**');
    }
  },
);

Then(
  'the backup warning box reports the storage error with a Retry move action',
  async ({ page, ctx }) => {
    const account = requireAccount(ctx);
    const box = page.getByRole('alert').filter({ hasText: STORAGE_ERROR });
    await expect(box).toBeVisible();
    await expect(box).toContainText(
      `${account.user.displayName}'s account was updated, but the S3 backup was not moved.`,
    );
    await expect(box.getByRole('button', { name: 'Retry move' })).toBeEnabled();
  },
);

When('the account-editing admin retries the backup move', async ({ page }) => {
  // the retry hits the real endpoint — the scenario account has no backup, so it answers
  // reason "no-backup" and the warning box clears
  await page.getByRole('button', { name: 'Retry move' }).click();
  await expect(page.getByText(STORAGE_ERROR)).toHaveCount(0, { timeout: 120_000 });
});

Then('the backup warning box is cleared', async ({ page }) => {
  await expect(page.getByRole('alert').filter({ hasText: STORAGE_ERROR })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry move' })).toHaveCount(0);
});

When(
  'the account-editing admin attempts a role change through the admin API',
  async ({ request, ctx }) => {
    const admin = await requireEditAdmin(request, ctx);
    const account = requireAccount(ctx);
    const response = await request.patch(`/api/v1/admin/users/${account.user.id}`, {
      headers: authHeaders(admin),
      data: { role: 'admin' },
    });
    editState(ctx).roleChangeStatus = response.status();
  },
);

Then('the role change is rejected as a bad request', ({ ctx }) => {
  expect(editState(ctx).roleChangeStatus).toBe(400);
});

Then("the account's role is unchanged", async ({ request, ctx }) => {
  const admin = await requireEditAdmin(request, ctx);
  const account = requireAccount(ctx);
  const response = await request.get(
    `/api/v1/admin/users?q=${encodeURIComponent(account.user.email)}`,
    { headers: authHeaders(admin) },
  );
  expect(response.status()).toBe(200);
  const list = (await response.json()) as { items: { id: string; role: string }[]; total: number };
  expect(list.total).toBe(1);
  expect(list.items[0]?.id).toBe(account.user.id);
  expect(list.items[0]?.role).toBe('user');
});
