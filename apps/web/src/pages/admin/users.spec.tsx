import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AdminUserListResponse, AdminUserRow } from '@photox/shared-types'
import { useAuthStore } from '../../store/auth-store'

const api = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  deleteAdminUser: vi.fn(),
  pollAdminUserDelete: vi.fn(),
  updateAdminUser: vi.fn(),
  syncAdminUserBackup: vi.fn(),
}))

vi.mock('../../api/admin', () => api)

import { UsersSection } from './users'

const ada: AdminUserRow = {
  id: 'u-1',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'admin',
  createdAt: '2026-01-02T00:00:00.000Z',
}

const grace: AdminUserRow = {
  id: 'u-2',
  displayName: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'user',
  createdAt: '2026-02-03T00:00:00.000Z',
}

const page = (over: Partial<AdminUserListResponse> = {}): AdminUserListResponse => ({
  items: [ada, grace],
  total: 42,
  limit: 20,
  offset: 0,
  ...over,
})

const idleAuth = {
  user: null,
  accessToken: null,
  refreshToken: null,
  status: 'idle',
  error: null,
} as const

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })

async function openDeleteDialogFor(name: string) {
  fireEvent.click(button(`Delete ${name}`))
  await screen.findByRole('dialog', { name: 'Delete user confirmation' })
}

function confirmWith(text: string) {
  fireEvent.change(screen.getByLabelText(/DELETE to confirm/), { target: { value: text } })
  fireEvent.click(button('Delete user'))
}

const nameInput = () => screen.getByLabelText<HTMLInputElement>('Name')
const emailInput = () => screen.getByLabelText<HTMLInputElement>('Email')
const passwordInput = () => screen.getByLabelText<HTMLInputElement>('New password')
const saveButton = () => button('Save changes')

async function openEditDialogFor(name: string) {
  fireEvent.click(button(`Edit ${name}`))
  await screen.findByRole('dialog', { name: 'Edit user account' })
}

/** A save that has been accepted but not answered yet — the long backup-move window. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const updatedAda = {
  ...ada,
  displayName: 'Ada Byron',
  updatedAt: '2026-10-05T00:00:00.000Z',
}

const updatedGrace = {
  ...grace,
  email: 'grace@new.example',
  updatedAt: '2026-10-05T00:00:00.000Z',
}

const selfAdmin = {
  id: 'u-1',
  email: 'ada@example.com',
  role: 'admin' as const,
  displayName: 'Ada Lovelace',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

beforeEach(() => {
  api.listAdminUsers.mockResolvedValue(page())
  api.deleteAdminUser.mockResolvedValue({ jobId: 'job-1' })
  api.pollAdminUserDelete.mockResolvedValue(undefined)
  api.updateAdminUser.mockResolvedValue({
    user: updatedAda,
    backup: { synced: true, moved: false, to: 'backups/ada%40example.com__u-1/' },
  })
  api.syncAdminUserBackup.mockResolvedValue({
    synced: true,
    moved: true,
    from: 'backups/grace%40example.com__u-2/',
    to: 'backups/grace%40new.example__u-2/',
  })
  useAuthStore.setState({ ...idleAuth })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('UsersSection', () => {
  it('renders the four columns, row identities and the pagination strip', async () => {
    render(<UsersSection />)

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('u-1')).toBeTruthy()
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    expect(button('User')).toBeTruthy()
    expect(button('Email')).toBeTruthy()
    expect(button('Role')).toBeTruthy()
    expect(button('Created')).toBeTruthy()
    expect(screen.getByText('Showing 42 registered user(s)')).toBeTruthy()
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
  })

  it('debounces the search input before querying', async () => {
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'grace' } })
    // still debounced — nothing fired synchronously
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)

    await waitFor(() =>
      expect(api.listAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'grace', offset: 0 }),
      ),
    )
  })

  it('toggles the sort direction when the same header is clicked twice', async () => {
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')

    fireEvent.click(button('Role'))
    await waitFor(() =>
      expect(api.listAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortField: 'role', sortDir: 'asc' }),
      ),
    )

    fireEvent.click(button('Role'))
    await waitFor(() =>
      expect(api.listAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortField: 'role', sortDir: 'desc' }),
      ),
    )
  })

  it('keeps Prev disabled on the first page and pages forward with Next', async () => {
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')

    expect(button('Prev').disabled).toBe(true)
    expect(button('Next').disabled).toBe(false)

    api.listAdminUsers.mockResolvedValue(page({ offset: 20 }))
    fireEvent.click(button('Next'))

    await waitFor(() =>
      expect(api.listAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 20, offset: 20 }),
      ),
    )
    await waitFor(() => expect(button('Prev').disabled).toBe(false))
  })

  it('disables Next on the last page', async () => {
    api.listAdminUsers.mockResolvedValue(page({ total: 5, offset: 0 }))
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')

    expect(screen.getByText('Page 1 of 1')).toBeTruthy()
    expect(button('Next').disabled).toBe(true)
  })
})

describe('UsersSection delete actions', () => {
  it('renders an Actions column with an enabled Delete button per row', async () => {
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')

    expect(screen.getByText('Actions')).toBeTruthy()
    // total (42) exceeds the loaded page, so the last-admin guard stays server-side
    expect(button('Delete Ada Lovelace').disabled).toBe(false)
    expect(button('Delete Grace Hopper').disabled).toBe(false)
  })

  it('disables Delete for the current user', async () => {
    useAuthStore.setState({
      ...idleAuth,
      user: {
        id: 'u-1',
        email: 'ada@example.com',
        role: 'admin',
        displayName: 'Ada Lovelace',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    })
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')

    const selfDelete = button('Delete Ada Lovelace')
    expect(selfDelete.disabled).toBe(true)
    expect(selfDelete.title).toBe("You can't delete your own account.")
    expect(button('Delete Grace Hopper').disabled).toBe(false)
  })

  it('disables Delete for the last remaining admin when fully loaded', async () => {
    api.listAdminUsers.mockResolvedValue(page({ items: [ada], total: 1 }))
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')

    const lastAdmin = button('Delete Ada Lovelace')
    expect(lastAdmin.disabled).toBe(true)
    expect(lastAdmin.title).toBe("The last admin can't be deleted.")
  })

  it('requires typing DELETE before the confirm button enables', async () => {
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openDeleteDialogFor('Grace Hopper')

    const confirm = button('Delete user')
    expect(confirm.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/DELETE to confirm/), { target: { value: 'DEL' } })
    expect(button('Delete user').disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/DELETE to confirm/), { target: { value: 'DELETE' } })
    expect(button('Delete user').disabled).toBe(false)
    expect(api.deleteAdminUser).not.toHaveBeenCalled()
  })

  it('renders the generic impact wording directly with no preview fetch', async () => {
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openDeleteDialogFor('Grace Hopper')

    expect(
      await screen.findByText(
        'Their photos, videos, albums and shares will be permanently removed.',
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Loading account details')).toBeNull()
  })

  it('always polls the delete job after the 202 accept', async () => {
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)

    await openDeleteDialogFor('Grace Hopper')
    confirmWith('DELETE')

    await waitFor(() => expect(api.deleteAdminUser).toHaveBeenCalledWith('u-2'))
    await waitFor(() => expect(api.pollAdminUserDelete).toHaveBeenCalledWith('u-2'))
    await waitFor(() => expect(api.listAdminUsers).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Deleted Grace Hopper.')).toBeTruthy()
  })

  it('surfaces the last-admin guard when the server rejects with 409', async () => {
    api.deleteAdminUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: {} },
      message: 'Conflict',
    })
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')

    await openDeleteDialogFor('Ada Lovelace')
    confirmWith('DELETE')

    expect(await screen.findByText("The last admin can't be deleted.")).toBeTruthy()
    // the dialog stays open so Cancel is still available
    expect(screen.getByRole('dialog', { name: 'Delete user confirmation' })).toBeTruthy()
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)
  })

  it('surfaces the self-delete guard when the server rejects with 403', async () => {
    api.deleteAdminUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: {} },
      message: 'Forbidden',
    })
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')

    await openDeleteDialogFor('Grace Hopper')
    confirmWith('DELETE')

    expect(await screen.findByText("You can't delete your own account.")).toBeTruthy()
  })

  it('treats a 404 as a missing user and keeps the dialog open', async () => {
    api.deleteAdminUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: {} },
      message: 'Not found',
    })
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')

    await openDeleteDialogFor('Grace Hopper')
    confirmWith('DELETE')

    expect(
      await screen.findByText('That user no longer exists. Close this and refresh the list.'),
    ).toBeTruthy()
  })
})

describe('UsersSection edit actions', () => {
  it('renders an Edit action beside Delete and opens the dialog prefilled', async () => {
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')

    expect(button('Edit Ada Lovelace').disabled).toBe(false)
    await openEditDialogFor('Ada Lovelace')

    expect(nameInput().value).toBe('Ada Lovelace')
    expect(emailInput().value).toBe('ada@example.com')
    expect(passwordInput().value).toBe('')
    expect(passwordInput().placeholder).toBe('Leave blank to keep current password')
  })

  it('keeps Save disabled until a field really changes', async () => {
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')
    await openEditDialogFor('Ada Lovelace')

    expect(saveButton().disabled).toBe(true)

    // whitespace around the name and a differently-cased email are not changes
    fireEvent.change(nameInput(), { target: { value: ' Ada Lovelace ' } })
    fireEvent.change(emailInput(), { target: { value: 'ADA@example.com' } })
    expect(saveButton().disabled).toBe(true)

    fireEvent.change(passwordInput(), { target: { value: 'short' } })
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy()

    fireEvent.change(passwordInput(), { target: { value: '' } })
    fireEvent.change(nameInput(), { target: { value: 'Ada L.' } })
    expect(saveButton().disabled).toBe(false)
    expect(api.updateAdminUser).not.toHaveBeenCalled()
  })

  it('sends only the changed fields and refreshes the list', async () => {
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)

    await openEditDialogFor('Ada Lovelace')
    fireEvent.change(nameInput(), { target: { value: 'Ada Byron' } })
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.updateAdminUser).toHaveBeenCalledWith('u-1', { displayName: 'Ada Byron' }),
    )
    await waitFor(() => expect(api.listAdminUsers).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Updated Ada Byron.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Edit user account' })).toBeNull()
  })

  it('sends the new password and email when both are typed', async () => {
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openEditDialogFor('Grace Hopper')

    fireEvent.change(emailInput(), { target: { value: 'Grace@New.Example' } })
    fireEvent.change(passwordInput(), { target: { value: 'correcthorse' } })
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.updateAdminUser).toHaveBeenCalledWith('u-2', {
        email: 'Grace@New.Example',
        password: 'correcthorse',
      }),
    )
  })

  it('shows the backup-move progress and refuses to close while the save is in flight', async () => {
    const pending = deferred<{ user: typeof updatedGrace; backup: unknown }>()
    api.updateAdminUser.mockReturnValue(pending.promise)

    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openEditDialogFor('Grace Hopper')

    fireEvent.change(emailInput(), { target: { value: 'grace@new.example' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText('Moving the S3 backup to the new address…')).toBeTruthy()
    expect(button('Updating…').disabled).toBe(true)
    expect(button('Cancel').disabled).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Edit user account' })).toBeTruthy()

    pending.resolve({
      user: updatedGrace,
      backup: {
        synced: true,
        moved: true,
        from: 'backups/grace%40example.com__u-2/',
        to: 'backups/grace%40new.example__u-2/',
      },
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit user account' })).toBeNull(),
    )
    expect(
      await screen.findByText('Updated Grace Hopper. S3 backup moved to the new address.'),
    ).toBeTruthy()
  })

  it('warns that the account changed but the backup did not, and retries the move', async () => {
    api.updateAdminUser.mockResolvedValue({
      user: updatedGrace,
      backup: {
        synced: false,
        moved: false,
        to: 'backups/grace%40new.example__u-2/',
        error: 'connect ECONNREFUSED 127.0.0.1:4566',
      },
    })

    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openEditDialogFor('Grace Hopper')

    fireEvent.change(emailInput(), { target: { value: 'grace@new.example' } })
    fireEvent.click(saveButton())

    const warning = await screen.findByRole('alert')
    expect(warning.textContent).toContain(
      "Grace Hopper's account was updated, but the S3 backup was not moved.",
    )
    expect(warning.textContent).toContain('connect ECONNREFUSED 127.0.0.1:4566')
    // the dialog is done — the account itself was saved. No toast: the persistent box is the
    // message, and a backdrop that fades in three seconds would understate it.
    expect(screen.queryByRole('dialog', { name: 'Edit user account' })).toBeNull()
    expect(screen.queryByText(/^Updated /)).toBeNull()

    fireEvent.click(button('Retry move'))
    await waitFor(() => expect(api.syncAdminUserBackup).toHaveBeenCalledWith('u-2'))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(await screen.findByText('S3 backup moved for grace@new.example.')).toBeTruthy()
  })

  it('reports a retry that still cannot reach storage without losing the warning', async () => {
    api.updateAdminUser.mockResolvedValue({
      user: updatedGrace,
      backup: {
        synced: false,
        moved: false,
        to: 'backups/grace%40new.example__u-2/',
        error: 'S3 down',
      },
    })
    api.syncAdminUserBackup.mockResolvedValue({
      synced: false,
      moved: false,
      to: 'backups/grace%40new.example__u-2/',
      error: 'still down',
    })

    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openEditDialogFor('Grace Hopper')
    fireEvent.change(emailInput(), { target: { value: 'grace@new.example' } })
    fireEvent.click(saveButton())

    await screen.findByRole('alert')
    fireEvent.click(button('Retry move'))

    expect(await screen.findByText('still down')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('treats a missing backup as nothing to move, not a failure', async () => {
    api.updateAdminUser.mockResolvedValue({
      user: updatedGrace,
      backup: {
        synced: false,
        moved: false,
        to: 'backups/grace%40new.example__u-2/',
        reason: 'no-backup',
      },
    })

    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openEditDialogFor('Grace Hopper')

    fireEvent.change(emailInput(), { target: { value: 'grace@new.example' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText(/No S3 backup found, so nothing was moved\./)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.syncAdminUserBackup).not.toHaveBeenCalled()
  })

  it('keeps the backup warning accurate when only the name changed', async () => {
    api.updateAdminUser.mockResolvedValue({
      user: { ...grace, displayName: 'Grace B.', updatedAt: '2026-10-05T00:00:00.000Z' },
      backup: {
        synced: false,
        moved: false,
        to: 'backups/grace%40example.com__u-2/',
        error: 'S3 down',
      },
    })

    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openEditDialogFor('Grace Hopper')

    fireEvent.change(nameInput(), { target: { value: 'Grace B.' } })
    fireEvent.click(saveButton())

    const warning = await screen.findByRole('alert')
    expect(warning.textContent).toContain(
      "Grace B.'s account was updated, but its S3 backup was left behind.",
    )
    expect(warning.textContent).not.toContain('still under the old address')
  })

  it('maps a 409 to a plain sentence and keeps the dialog open', async () => {
    api.updateAdminUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: {} },
      message: 'Conflict',
    })

    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openEditDialogFor('Grace Hopper')

    fireEvent.change(emailInput(), { target: { value: 'ada@example.com' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText('That email is already in use.')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Edit user account' })).toBeTruthy()
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)
  })

  it('warns the signed-in admin only when their own email or password changes', async () => {
    useAuthStore.setState({ ...idleAuth, user: selfAdmin })
    render(<UsersSection />)
    await screen.findByText('Ada Lovelace')
    await openEditDialogFor('Ada Lovelace')

    fireEvent.change(nameInput(), { target: { value: 'Ada L.' } })
    expect(screen.queryByText(/ends this session on every device/)).toBeNull()

    fireEvent.change(emailInput(), { target: { value: 'ada.l@example.com' } })
    expect(await screen.findByText(/ends this session on every device/)).toBeTruthy()
    expect(
      screen.getByText(
        "Changing the email also moves this account's S3 backup to the new address. A large library can take a few minutes.",
      ),
    ).toBeTruthy()
  })
})
