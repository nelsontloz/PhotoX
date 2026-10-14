import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AdminUserListResponse, AdminUserRow } from '@photox/shared-types'
import { useAuthStore } from '../../store/auth-store'

const api = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  deleteAdminUser: vi.fn(),
  getAdminUserDeletePreview: vi.fn(),
  pollAdminUserDelete: vi.fn(),
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

beforeEach(() => {
  api.listAdminUsers.mockResolvedValue(page())
  api.getAdminUserDeletePreview.mockResolvedValue(null)
  api.deleteAdminUser.mockResolvedValue({})
  api.pollAdminUserDelete.mockResolvedValue(undefined)
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

  it('shows preview counts and the S3-kept note in the dialog', async () => {
    api.getAdminUserDeletePreview.mockResolvedValue({ userId: 'u-2', assets: 12, files: 30 })
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openDeleteDialogFor('Grace Hopper')

    expect(await screen.findByText('12 assets · 30 files will be permanently removed.'))
    expect(screen.getByText(/S3 backup is kept/)).toBeTruthy()
  })

  it('falls back to generic wording when no preview is available', async () => {
    api.getAdminUserDeletePreview.mockResolvedValue(null)
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    await openDeleteDialogFor('Grace Hopper')

    expect(
      await screen.findByText(
        'Their photos, videos, albums and shares will be permanently removed.',
      ),
    ).toBeTruthy()
  })

  it('deletes, shows a success note and refetches the list on confirm', async () => {
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)

    await openDeleteDialogFor('Grace Hopper')
    confirmWith('DELETE')

    await waitFor(() => expect(api.deleteAdminUser).toHaveBeenCalledWith('u-2'))
    expect(api.pollAdminUserDelete).not.toHaveBeenCalled()
    await waitFor(() => expect(api.listAdminUsers).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Deleted Grace Hopper.')).toBeTruthy()
  })

  it('polls the delete job when the server answers 202 with a job id', async () => {
    api.deleteAdminUser.mockResolvedValue({ jobId: 'job-1' })
    render(<UsersSection />)
    await screen.findByText('Grace Hopper')

    await openDeleteDialogFor('Grace Hopper')
    confirmWith('DELETE')

    await waitFor(() => expect(api.pollAdminUserDelete).toHaveBeenCalledWith('u-2'))
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
