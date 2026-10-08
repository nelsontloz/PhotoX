import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AdminUserListResponse } from '@photox/shared-types'

const api = vi.hoisted(() => ({ listAdminUsers: vi.fn() }))

vi.mock('../../api/admin', () => api)

import { UsersSection } from './index'

const page = (over: Partial<AdminUserListResponse> = {}): AdminUserListResponse => ({
  items: [
    {
      id: 'u-1',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'admin',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'u-2',
      displayName: 'Grace Hopper',
      email: 'grace@example.com',
      role: 'user',
      createdAt: '2026-02-03T00:00:00.000Z',
    },
  ],
  total: 42,
  limit: 20,
  offset: 0,
  ...over,
})

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })

beforeEach(() => {
  api.listAdminUsers.mockResolvedValue(page())
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
