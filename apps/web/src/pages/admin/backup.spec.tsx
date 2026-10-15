import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { BackupOverviewRow, BackupResult, RestoreResult } from '../../api/admin'

const api = vi.hoisted(() => ({
  getBackupOverview: vi.fn(),
  getBackupProgress: vi.fn(),
  backupUser: vi.fn(),
  restoreUser: vi.fn(),
  deleteBackup: vi.fn(),
  backupPrefixPreview: (email: string, userId: string) =>
    `backups/${encodeURIComponent(email.trim().toLowerCase())}__${encodeURIComponent(userId)}/`,
}))

vi.mock('../../api/admin', () => api)

import { BackupSection } from './backups'

const ada: BackupOverviewRow = {
  userId: 'u-1',
  email: 'ada@example.com',
  role: 'user',
  totalAssets: 100,
  backedUpAssets: 85,
  backedUpFiles: 120,
  backedUpAt: '2026-10-01T00:00:00.000Z',
  exists: true,
  notBackedUp: 15,
  deleted: false,
}

const grace: BackupOverviewRow = {
  userId: 'u-2',
  email: 'grace@example.com',
  role: 'user',
  totalAssets: 10,
  backedUpAssets: 0,
  backedUpFiles: 0,
  backedUpAt: undefined,
  exists: false,
  notBackedUp: 10,
  deleted: false,
}

const orphan: BackupOverviewRow = {
  userId: 'u-3',
  email: 'gone@example.com',
  role: 'user',
  totalAssets: 0,
  backedUpAssets: 40,
  backedUpFiles: 55,
  backedUpAt: '2026-10-03T00:00:00.000Z',
  exists: true,
  notBackedUp: 0,
  deleted: true,
}

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

const restoreResult: RestoreResult = {
  userId: 'u-3',
  email: 'gone@example.com',
  prefix: 'backups/gone%40example.com__u-3/',
  backedUpAt: '2026-10-03T00:00:00.000Z',
  files: 55,
  uploaded: 55,
  skipped: 0,
  assets: 40,
  albums: 2,
  shares: 1,
  persons: 3,
  restoredFrom: {
    emailAtBackup: 'gone@example.com',
    prefix: 'backups/gone%40example.com__u-3/',
    manifestObjectKey: 'backups/gone%40example.com__u-3/manifest.json',
  },
  startedAt: '2026-10-04T00:00:00.000Z',
  completedAt: '2026-10-04T00:01:00.000Z',
  enqueued: { metadata: 40, thumbnails: 40, videos: 0, faces: 40, ai: 0 },
}

const notFound = () => ({ isAxiosError: true, response: { status: 404 }, message: 'Not found' })

beforeEach(() => {
  api.getBackupOverview.mockResolvedValue([ada, grace])
  api.getBackupProgress.mockRejectedValue(notFound())
  api.backupUser.mockResolvedValue(result)
  api.restoreUser.mockResolvedValue(restoreResult)
  api.deleteBackup.mockResolvedValue({
    userId: 'u-1',
    email: 'ada@example.com',
    prefix: 'backups/ada%40example.com__u-1/',
    deletedObjects: 125,
  })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

async function rowsReady() {
  expect(await screen.findByText('ada@example.com')).toBeTruthy()
  expect(screen.getByText('grace@example.com')).toBeTruthy()
}

describe('BackupSection table', () => {
  it('renders every user with status, counts, pending and last backup', async () => {
    render(<BackupSection />)
    await rowsReady()

    expect(screen.getByText('Backed up')).toBeTruthy()
    expect(screen.getByText('None')).toBeTruthy()
    // ada: 85 assets, 120 files, 15 pending
    const adaRow = screen.getByText('ada@example.com').closest('tr') as HTMLElement
    expect(within(adaRow).getByText('85')).toBeTruthy()
    expect(within(adaRow).getByText('120')).toBeTruthy()
    expect(within(adaRow).getByText('15')).toBeTruthy()
    expect(screen.getByText('1 of 2 backed up · 25 assets pending')).toBeTruthy()
    expect(screen.getByText('Showing 2 of 2 users')).toBeTruthy()
  })

  it('filters client-side by email without refetching', async () => {
    render(<BackupSection />)
    await rowsReady()
    expect(api.getBackupOverview).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('Filter backups by email'), {
      target: { value: 'grace' },
    })

    expect(screen.queryByText('ada@example.com')).toBeNull()
    expect(screen.getByText('grace@example.com')).toBeTruthy()
    expect(api.getBackupOverview).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Showing 1 of 1 user')).toBeTruthy()
  })

  it('hides Restore for live rows', async () => {
    render(<BackupSection />)
    await rowsReady()

    expect(screen.queryByRole('button', { name: 'Restore ada@example.com' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restore grace@example.com' })).toBeNull()
  })

  it('confirms a per-row backup, toasts the counts and updates the row', async () => {
    let finish: (value: BackupResult) => void = () => undefined
    api.backupUser.mockReturnValue(
      new Promise<BackupResult>((resolve) => {
        finish = resolve
      }),
    )

    render(<BackupSection />)
    await rowsReady()

    fireEvent.click(screen.getByRole('button', { name: 'Back up grace@example.com' }))
    expect(screen.getByText('Back up grace@example.com?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.backupUser).toHaveBeenCalledWith('u-2'))

    // disabled while the inline backup runs + indeterminate progress (old core, no progress endpoint)
    expect(await screen.findByText('Backing up grace@example.com…')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Back up all users' }).disabled,
    ).toBe(true)

    await act(async () => {
      finish({ ...result, userId: 'u-2', email: 'grace@example.com' })
      await Promise.resolve()
    })

    expect(
      await screen.findByText(/Backed up grace@example.com — 121 files \(3 new, 118 unchanged\)/),
    ).toBeTruthy()
    expect(screen.queryByText('Backing up grace@example.com…')).toBeNull()
  })

  it('surfaces a per-row failure as an error toast without axios verbatim', async () => {
    api.backupUser.mockRejectedValue(new Error('Request failed with status code 500'))

    render(<BackupSection />)
    await rowsReady()

    fireEvent.click(screen.getByRole('button', { name: 'Back up ada@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/Backup of ada@example.com failed/)).toBeTruthy()
    expect(screen.queryByText('Request failed with status code 500')).toBeNull()
    // row stays usable after the failure
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Back up ada@example.com' }).disabled,
    ).toBe(false)
  })

  it('shows degraded pills with a rerun hint', async () => {
    api.getBackupOverview.mockResolvedValue([
      { ...ada, degraded: 'unreadable' },
      { ...grace, degraded: 'corrupt', exists: true },
    ])

    render(<BackupSection />)
    expect(await screen.findByText('Unreadable')).toBeTruthy()
    expect(screen.getByText('Corrupt')).toBeTruthy()
    expect(screen.getAllByText(/rerun the backup/i).length).toBe(2)
  })

  it('maps a 503 overview load to the Floci copy with a retry', async () => {
    api.getBackupOverview.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503 },
      message: 'Request failed with status code 503',
    })

    render(<BackupSection />)
    expect(await screen.findByText("Can't reach backup storage")).toBeTruthy()
    expect(screen.getByText(/Floci is running/)).toBeTruthy()
    expect(screen.queryByText('Request failed with status code 503')).toBeNull()

    api.getBackupOverview.mockResolvedValue([ada])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('ada@example.com')).toBeTruthy()
  })

  it('shows the all-skipped note when every file was already backed up', async () => {
    api.backupUser.mockResolvedValue({ ...result, uploaded: 0, skipped: 121 })

    render(<BackupSection />)
    await rowsReady()

    fireEvent.click(screen.getByRole('button', { name: 'Back up ada@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/0 new, 121 unchanged.*nothing new/)).toBeTruthy()
    expect(screen.getByText('Nothing new — already backed up.')).toBeTruthy()
  })

  it('polls progress per row and renders the determinate bar', async () => {
    let finish: (value: BackupResult) => void = () => undefined
    api.backupUser.mockReturnValue(
      new Promise<BackupResult>((resolve) => {
        finish = resolve
      }),
    )
    api.getBackupProgress.mockResolvedValue({
      userId: 'u-1',
      inProgress: true,
      total: 10,
      completed: 4,
      uploaded: 1,
      skipped: 3,
    })

    render(<BackupSection />)
    await rowsReady()

    fireEvent.click(screen.getByRole('button', { name: 'Back up ada@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByLabelText('Backup progress for ada@example.com')).toBeTruthy()
    expect(screen.getByText('4/10 (1 new, 3 unchanged)')).toBeTruthy()
    expect(api.getBackupProgress).toHaveBeenCalledWith('u-1')

    await act(async () => {
      finish(result)
      await Promise.resolve()
    })
  })

  it('backs up all users sequentially and finishes with a summary toast', async () => {
    const calls: string[] = []
    api.backupUser.mockImplementation((id: string) => {
      calls.push(id)
      if (id === 'u-1') return Promise.resolve({ ...result, userId: 'u-1' })
      return Promise.resolve({
        ...result,
        userId: 'u-2',
        email: 'grace@example.com',
        assets: 10,
        files: 12,
      })
    })

    render(<BackupSection />)
    await rowsReady()

    fireEvent.click(screen.getByRole('button', { name: 'Back up all users' }))
    expect(screen.getByText('Back up 2 users?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back up all' }))
    await waitFor(() => expect(api.backupUser).toHaveBeenCalledTimes(2))
    expect(calls).toEqual(['u-1', 'u-2'])
    expect(await screen.findByText('Backup-all finished — 2 users backed up.')).toBeTruthy()
  })

  it('previews an encoded prefix for uppercase emails in the confirm dialog', async () => {
    api.getBackupOverview.mockResolvedValue([{ ...ada, email: 'Ada@Example.COM' }])

    render(<BackupSection />)
    expect(await screen.findByText('Ada@Example.COM')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back up Ada@Example.COM' }))
    expect(screen.getByText('Back up Ada@Example.COM?')).toBeTruthy()
    expect(screen.getByText('backups/ada%40example.com__u-1/')).toBeTruthy()
  })
})

describe('BackupSection orphans', () => {
  beforeEach(() => {
    api.getBackupOverview.mockResolvedValue([ada, orphan])
  })

  it('renders orphan rows with a Deleted pill, zero pending and a Restore action', async () => {
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    expect(screen.getByText('Deleted user')).toBeTruthy()
    const row = screen.getByText('gone@example.com').closest('tr') as HTMLElement
    // manifest counts show, pending is zero for deleted rows
    expect(within(row).getByText('40')).toBeTruthy()
    expect(within(row).getByText('55')).toBeTruthy()
    expect(within(row).getByText('0')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Restore gone@example.com' }),
    ).toBeTruthy()
    const backup = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Back up gone@example.com (deleted — restore first)',
    })
    expect(backup.disabled).toBe(true)
    expect(screen.getByText('2 of 2 backed up · 15 assets pending · 1 deleted')).toBeTruthy()
  })

  it('shows the email-at-backup hint only when it differs', async () => {
    api.getBackupOverview.mockResolvedValue([{ ...orphan, emailAtBackup: 'older@example.com' }])
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()
    expect(screen.getByText('Backup saved as older@example.com')).toBeTruthy()
  })

  it('filters by All / Active / Deleted with counts that follow the filter', async () => {
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()
    expect(screen.getByText('ada@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    expect(screen.queryByText('ada@example.com')).toBeNull()
    expect(screen.getByText('gone@example.com')).toBeTruthy()
    expect(screen.getByText('1 of 1 backed up · 0 assets pending · 1 deleted')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    expect(screen.queryByText('gone@example.com')).toBeNull()
  })

  it('confirms a restore, toasts the actual address and refreshes the list', async () => {
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore gone@example.com' }))
    expect(screen.getByText('Restore gone@example.com?')).toBeTruthy()
    expect(screen.getByText('backups/gone%40example.com__u-3/')).toBeTruthy()
    expect(screen.getByText(/40 assets and 55 files/)).toBeTruthy()
    expect(screen.getByText(/If that address is taken/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(api.restoreUser).toHaveBeenCalledWith('u-3'))
    expect(await screen.findByText(/Restored gone@example.com — 40 assets, 55 files/)).toBeTruthy()
    // success re-reads the overview so the restored account shows as live
    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
  })

  it('toasts the fallback address when the backup-time address was taken', async () => {
    api.restoreUser.mockResolvedValue({ ...restoreResult, email: 'restored-1-gone@example.com' })
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore gone@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText(/Restored restored-1-gone@example.com/)).toBeTruthy()
    expect(screen.getByText(/Sign in as restored-1-gone@example.com/)).toBeTruthy()
  })

  it('maps a 409 already-restored to a row error and refreshes', async () => {
    api.restoreUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409 },
      message: 'Conflict',
    })
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore gone@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText(/Restore of gone@example.com failed/)).toBeTruthy()
    expect(screen.getAllByText(/already back/).length).toBeGreaterThanOrEqual(1)
    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
  })

  it('maps a 404 missing backup to a row error without refreshing', async () => {
    api.restoreUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
      message: 'Not found',
    })
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore gone@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText(/Restore of gone@example.com failed/)).toBeTruthy()
    const row = screen.getByText('gone@example.com').closest('tr') as HTMLElement
    expect(within(row).getByText(/No backup found/)).toBeTruthy()
    expect(screen.getAllByText(/No backup found/).length).toBeGreaterThanOrEqual(1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(api.getBackupOverview).toHaveBeenCalledTimes(1)
  })

  it('maps a 422 corrupt backup to a row error without refreshing', async () => {
    api.restoreUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 422 },
      message: 'Unprocessable',
    })
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore gone@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText(/Restore of gone@example.com failed/)).toBeTruthy()
    const row = screen.getByText('gone@example.com').closest('tr') as HTMLElement
    expect(within(row).getByText(/damaged and cannot be restored/)).toBeTruthy()
    expect(screen.getAllByText(/damaged and cannot be restored/).length).toBeGreaterThanOrEqual(1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(api.getBackupOverview).toHaveBeenCalledTimes(1)
  })

  it('clears the 409 row error once the reload shows the row as live', async () => {
    api.restoreUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409 },
      message: 'Conflict',
    })
    const liveOrphan: BackupOverviewRow = { ...orphan, deleted: false }
    api.getBackupOverview.mockResolvedValueOnce([ada, orphan]).mockResolvedValue([ada, liveOrphan])
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore gone@example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText(/Restore of gone@example.com failed/)).toBeTruthy()
    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.queryByText('That account is already back — the list was refreshed to show it.'),
      ).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: 'Restore gone@example.com' })).toBeNull()
  })

  it('backup-all skips deleted rows', async () => {
    const calls: string[] = []
    api.backupUser.mockImplementation((id: string) => {
      calls.push(id)
      return Promise.resolve({ ...result, userId: id })
    })
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back up all users' }))
    expect(screen.getByText('Back up 1 user?')).toBeTruthy()
    expect(screen.getByText(/Deleted backups are skipped/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back up all' }))
    await waitFor(() => expect(api.backupUser).toHaveBeenCalledTimes(1))
    expect(calls).toEqual(['u-1'])
    expect(api.restoreUser).not.toHaveBeenCalled()
  })
})

describe('BackupSection delete', () => {
  beforeEach(() => {
    api.getBackupOverview.mockResolvedValue([ada, orphan])
  })

  it('shows a Delete action on live rows next to Backup and on orphan rows next to Restore', async () => {
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Delete backup for ada@example.com',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Delete backup for gone@example.com',
      }),
    ).toBeTruthy()
    // live rows keep Backup; orphans keep Restore with Backup disabled
    expect(screen.getByRole('button', { name: 'Back up ada@example.com' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restore gone@example.com' })).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Back up gone@example.com (deleted — restore first)',
      }).disabled,
    ).toBe(true)
  })

  it('keeps the delete confirm disabled until DELETE is typed', async () => {
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete backup for ada@example.com' }))
    expect(screen.getByText('Delete backup for ada@example.com?')).toBeTruthy()
    expect(screen.getByText('backups/ada%40example.com__u-1/')).toBeTruthy()
    expect(screen.getByText(/85 assets and 120 files/)).toBeTruthy()
    expect(screen.getByText(/can't be undone/)).toBeTruthy()
    expect(screen.getByText(/Only the S3 backup is removed.*next Backup recreates it/)).toBeTruthy()

    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Delete backup' })
    expect(confirm.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), {
      target: { value: 'delet' },
    })
    expect(confirm.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), {
      target: { value: 'DELETE' },
    })
    expect(confirm.disabled).toBe(false)
    expect(api.deleteBackup).not.toHaveBeenCalled()
  })

  it('warns that the deleted account stays deleted on orphan rows', async () => {
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete backup for gone@example.com' }))
    expect(screen.getByText('Delete backup for gone@example.com?')).toBeTruthy()
    expect(screen.getByText(/40 assets and 55 files/)).toBeTruthy()
    expect(screen.getByText('The deleted account stays deleted.')).toBeTruthy()
  })

  it('confirms a delete, toasts the removed count and refreshes the list', async () => {
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete backup for ada@example.com' }))
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete backup' }))

    await waitFor(() => expect(api.deleteBackup).toHaveBeenCalledWith('u-1'))
    expect(
      await screen.findByText(/Deleted backup for ada@example.com — 125 objects removed/),
    ).toBeTruthy()
    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
  })

  it('maps a 404 delete to a row error and refreshes', async () => {
    api.deleteBackup.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
      message: 'Not found',
    })
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete backup for gone@example.com' }))
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete backup' }))

    await waitFor(() => expect(api.deleteBackup).toHaveBeenCalledWith('u-3'))
    const row = screen.getByText('gone@example.com').closest('tr') as HTMLElement
    expect(await within(row).findByText('No backup found — the list was refreshed.')).toBeTruthy()
    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
  })
})
