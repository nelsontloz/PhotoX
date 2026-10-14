import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AdminUserListResponse, AdminUserRow } from '@photox/shared-types'
import type { BackupResult, BackupStatus } from '../../api/admin'

const api = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  getBackupStatus: vi.fn(),
  backupUser: vi.fn(),
  backupPrefixPreview: (email: string, userId: string) =>
    `backups/${encodeURIComponent(email.trim().toLowerCase())}__${encodeURIComponent(userId)}/`,
}))

vi.mock('../../api/admin', () => api)

import { BackupSection } from './backups'

const ada: AdminUserRow = {
  id: 'u-1',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'user',
  createdAt: '2026-01-02T00:00:00.000Z',
}

const grace: AdminUserRow = {
  id: 'u-2',
  displayName: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'user',
  createdAt: '2026-02-03T00:00:00.000Z',
}

const list = (items: AdminUserRow[]): AdminUserListResponse => ({
  items,
  total: items.length,
  limit: 8,
  offset: 0,
})

const backedUp: BackupStatus = {
  exists: true,
  userId: 'u-1',
  emailAtBackup: 'ada@example.com',
  backedUpAt: '2026-10-01T00:00:00.000Z',
  files: 120,
  assets: 85,
  albums: 3,
  shares: 1,
  persons: 4,
}

const noBackup: BackupStatus = { exists: false }

const unreadable: BackupStatus = { exists: true, degraded: 'unreadable', userId: 'u-1' }

const corrupt: BackupStatus = { exists: true, degraded: 'corrupt', userId: 'u-1' }

const result: BackupResult = {
  userId: 'u-1',
  email: 'ada@example.com',
  prefix: 'backups/ada%40example.com__u-1/',
  backedUpAt: '2026-10-02T00:00:00.000Z',
  files: 121,
  uploaded: 3,
  skipped: 118,
  assets: 86,
  albums: 3,
  shares: 1,
  persons: 4,
}

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

/** Open the picker, type a query and wait for the debounced user search to land. */
async function search(query: string) {
  const input = screen.getByLabelText<HTMLInputElement>('Search users for backup')
  fireEvent.change(input, { target: { value: query } })
  await waitFor(() =>
    expect(api.listAdminUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: query, limit: 8 }),
    ),
  )
}

beforeEach(() => {
  api.listAdminUsers.mockResolvedValue(list([ada, grace]))
  api.getBackupStatus.mockResolvedValue(noBackup)
  api.backupUser.mockResolvedValue(result)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('BackupSection', () => {
  it('debounces the search, then picks a user and loads its backup status', async () => {
    render(<BackupSection />)

    expect(button('Run backup').disabled).toBe(true)

    // initial empty-query fetch, then nothing fires synchronously on typing
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)
    const input = screen.getByLabelText<HTMLInputElement>('Search users for backup')
    fireEvent.change(input, { target: { value: 'ada' } })
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1)

    await search('ada')
    fireEvent.click(button(/ada@example.com/))

    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledWith('u-1'))
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    expect(button('Run backup').disabled).toBe(false)

    api.getBackupStatus.mockResolvedValue(backedUp)
    fireEvent.click(screen.getByLabelText('Refresh backup status'))
    expect(await screen.findByText('Backed up')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
    expect(screen.getByText('85')).toBeTruthy()
    expect(screen.getByText('Email at backup')).toBeTruthy()
  })

  it('confirms, runs the backup and shows the counts toast plus progress while in flight', async () => {
    let finish: (value: BackupResult) => void = () => undefined
    api.backupUser.mockReturnValue(
      new Promise<BackupResult>((resolve) => {
        finish = resolve
      }),
    )

    render(<BackupSection />)
    await search('ada')
    fireEvent.click(button(/ada@example.com/))
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledWith('u-1'))

    fireEvent.click(button('Run backup'))
    expect(screen.getByText('Back up ada@example.com?')).toBeTruthy()
    expect(screen.getByText('backups/ada%40example.com__u-1/')).toBeTruthy()

    fireEvent.click(button('Confirm'))
    await waitFor(() => expect(api.backupUser).toHaveBeenCalledWith('u-1'))

    // progress + disabled while the inline backup runs
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByText('Backing up ada@example.com…')).toBeTruthy()
    expect(button('Backing up…').disabled).toBe(true)

    await act(async () => {
      finish(result)
      await Promise.resolve()
    })

    expect(await screen.findByText('Backed up 121 files (3 new, 118 unchanged)')).toBeTruthy()
    expect(screen.getByText(/3 uploaded, 118 skipped/)).toBeTruthy()
    expect(screen.queryByText('Nothing new — all files already backed up.')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(button('Run backup').disabled).toBe(false)
    // the status panel refreshes off the bumped version
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(2))
  })

  it('surfaces a backup failure as an error toast without axios verbatim', async () => {
    api.backupUser.mockRejectedValue(new Error('Request failed with status code 500'))

    render(<BackupSection />)
    await search('grace')
    fireEvent.click(button(/grace@example.com/))
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledWith('u-2'))

    fireEvent.click(button('Run backup'))
    fireEvent.click(button('Confirm'))

    expect(await screen.findByText('Backup failed')).toBeTruthy()
    expect(screen.queryByText('Request failed with status code 500')).toBeNull()
    expect(button('Run backup').disabled).toBe(false)
    expect(screen.queryByText(/Backed up/)).toBeNull()
  })

  it('shows the no-backup state when the manifest is missing', async () => {
    render(<BackupSection />)
    await search('grace')
    fireEvent.click(button(/grace@example.com/))

    expect(await screen.findByText('None')).toBeTruthy()
    expect(await screen.findByText('No backup yet for this user.')).toBeTruthy()
  })

  it('shows the unreadable degraded state and hides a stale Last run', async () => {
    api.getBackupStatus.mockResolvedValue(unreadable)

    render(<BackupSection />)
    await search('ada')
    fireEvent.click(button(/ada@example.com/))

    expect(await screen.findByText('Unreadable')).toBeTruthy()
    expect(await screen.findByText('Backup listed but unreadable')).toBeTruthy()
    expect(screen.getByText(/can't be fetched/)).toBeTruthy()
    expect(screen.queryByText(/Last run/)).toBeNull()

    // a fresh run must not resurrect the stale Last-run line while degraded
    fireEvent.click(button('Run backup'))
    fireEvent.click(button('Confirm'))
    await waitFor(() => expect(api.backupUser).toHaveBeenCalledWith('u-1'))
    expect(await screen.findByText(/Backed up 121 files/)).toBeTruthy()
    expect(screen.queryByText(/Last run/)).toBeNull()
    expect(screen.getByText('Unreadable')).toBeTruthy()
  })

  it('shows the corrupt degraded state and hides a stale Last run', async () => {
    api.getBackupStatus.mockResolvedValue(corrupt)

    render(<BackupSection />)
    await search('ada')
    fireEvent.click(button(/ada@example.com/))

    expect(await screen.findByText('Corrupt')).toBeTruthy()
    expect(await screen.findByText('Backup manifest is corrupt')).toBeTruthy()
    expect(screen.getByText(/isn't valid JSON/)).toBeTruthy()
    expect(screen.queryByText(/Last run/)).toBeNull()

    fireEvent.click(button('Run backup'))
    fireEvent.click(button('Confirm'))
    await waitFor(() => expect(api.backupUser).toHaveBeenCalledWith('u-1'))
    expect(await screen.findByText(/Backed up 121 files/)).toBeTruthy()
    expect(screen.queryByText(/Last run/)).toBeNull()
    expect(screen.getByText('Corrupt')).toBeTruthy()
  })

  it('maps a 503 status probe to the Floci copy, keeps Last run and never leaks axios verbatim', async () => {
    api.getBackupStatus.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503 },
      message: 'Request failed with status code 503',
    })

    render(<BackupSection />)
    await search('grace')
    fireEvent.click(button(/grace@example.com/))

    expect(await screen.findByText('Unavailable')).toBeTruthy()
    expect(await screen.findByText("Can't reach backup storage")).toBeTruthy()
    expect(screen.getByText(/Floci is running/)).toBeTruthy()
    expect(screen.queryByText('Request failed with status code 503')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()

    // Last run from a successful backup stays visible even while status probes fail
    fireEvent.click(button('Run backup'))
    fireEvent.click(button('Confirm'))
    await waitFor(() => expect(api.backupUser).toHaveBeenCalledWith('u-2'))
    expect(await screen.findByText(/Last run/)).toBeTruthy()
    expect(screen.queryByText('Request failed with status code 503')).toBeNull()
  })

  it('shows the all-skipped note when every file was already backed up', async () => {
    api.backupUser.mockResolvedValue({ ...result, uploaded: 0, skipped: 121 })

    render(<BackupSection />)
    await search('ada')
    fireEvent.click(button(/ada@example.com/))
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledWith('u-1'))

    fireEvent.click(button('Run backup'))
    fireEvent.click(button('Confirm'))

    expect(await screen.findByText('Backed up 121 files (0 new, 121 unchanged)')).toBeTruthy()
    expect(screen.getByText(/0 uploaded, 121 skipped/)).toBeTruthy()
    expect(screen.getByText('Nothing new — all files already backed up.')).toBeTruthy()
  })

  it('previews an encoded prefix for uppercase emails in the confirm dialog', async () => {
    const upper: AdminUserRow = { ...ada, email: 'Ada@Example.COM' }
    api.listAdminUsers.mockResolvedValue(list([upper]))

    render(<BackupSection />)
    await search('ada')
    fireEvent.click(button(/Ada@Example.COM/))
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledWith('u-1'))

    fireEvent.click(button('Run backup'))
    expect(screen.getByText('Back up Ada@Example.COM?')).toBeTruthy()
    expect(screen.getByText('backups/ada%40example.com__u-1/')).toBeTruthy()
    expect(screen.queryByText('backups/Ada@Example.COM__u-1/')).toBeNull()
  })
})
