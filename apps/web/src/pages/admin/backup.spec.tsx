import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  BackupOverviewRow,
  BackupResult,
  BackupSnapshot,
  MergeResult,
  RestoreResult,
} from '../../api/admin'

const api = vi.hoisted(() => ({
  getBackupOverview: vi.fn(),
  getBackupProgress: vi.fn(),
  backupUser: vi.fn(),
  restoreUser: vi.fn(),
  deleteBackup: vi.fn(),
  mergeBackup: vi.fn(),
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

const legacySnap: BackupSnapshot = {
  userId: 'u-legacy',
  emailAtBackup: 'admin@legacy.example.com',
  prefix: 'backups/admin%40legacy.example.com__u-legacy/',
  backedUpAt: '2026-09-01T00:00:00.000Z',
  assets: 3,
  files: 4,
  albums: 0,
  shares: 0,
  persons: 1,
}

const olderSnap: BackupSnapshot = {
  userId: 'u-legacy-old',
  emailAtBackup: 'admin@older.example.com',
  prefix: 'backups/admin%40older.example.com__u-legacy-old/',
  backedUpAt: '2026-08-01T00:00:00.000Z',
  assets: 2,
  files: 3,
  albums: 1,
  shares: 0,
  persons: 0,
}

// The live account has no backup of its own (None); the email-matched previous account sits
// in legacyBackups and must never leak into the row's status, counts or actions.
const matched: BackupOverviewRow = {
  userId: 'u-live',
  email: 'admin@example.com',
  role: 'admin',
  totalAssets: 48,
  backedUpAssets: 0,
  backedUpFiles: 0,
  exists: false,
  notBackedUp: 48,
  deleted: false,
  legacyBackups: [legacySnap],
}

const mergeResult: MergeResult = {
  targetUserId: 'u-live',
  targetEmail: 'admin@example.com',
  backupUserId: 'u-legacy',
  emailAtBackup: 'admin@legacy.example.com',
  prefix: legacySnap.prefix,
  backedUpAt: legacySnap.backedUpAt!,
  startedAt: '2026-10-06T00:00:00.000Z',
  completedAt: '2026-10-06T00:01:00.000Z',
  merged: { files: 48, assets: 48, albums: 2, albumAssets: 50, shares: 1, persons: 7 },
  deduped: { files: 5, assets: 5 },
  skipped: {
    files: 0,
    assets: 0,
    albums: 0,
    albumAssets: 0,
    shares: 0,
    persons: 0,
    shareTokenConflicts: 1,
    shareTargetConflicts: 1,
  },
  enqueued: { metadata: 48, thumbnails: 48, videos: 0, faces: 48, ai: 0 },
  assigned: {
    prefix: 'backups/admin%40example.com__u-live/',
    copiedObjects: 7,
    reusedObjects: 3,
    unionedWithExisting: false,
    sourceDeleted: true,
  },
}

const notFound = () => ({ isAxiosError: true, response: { status: 404 }, message: 'Not found' })

beforeEach(() => {
  api.getBackupOverview.mockResolvedValue([ada, grace])
  api.getBackupProgress.mockRejectedValue(notFound())
  api.backupUser.mockResolvedValue(result)
  api.restoreUser.mockResolvedValue(restoreResult)
  api.mergeBackup.mockResolvedValue(mergeResult)
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
    expect(screen.getByText(/Leave empty to use the backup address/)).toBeTruthy()
    expect(screen.getByText(/Sign in with the restored address/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(api.restoreUser).toHaveBeenCalledWith('u-3', undefined))
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

  it('maps a typed-address 409 email-taken to the choose-another copy and a 400 to invalid', async () => {
    api.restoreUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { message: 'email-taken' } },
      message: 'Conflict',
    })
    render(<BackupSection />)
    expect(await screen.findByText('gone@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore gone@example.com' }))
    fireEvent.change(screen.getByLabelText('New account email'), {
      target: { value: 'taken@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(
      await screen.findByText(
        /Restore of gone@example.com failed — That email is already in use — choose another address\./,
      ),
    ).toBeTruthy()
    const row = screen.getByText('gone@example.com').closest('tr') as HTMLElement
    expect(within(row).getByText(/already in use/)).toBeTruthy()
    // The already-restored copy never shows for this conflict.
    expect(screen.queryByText(/already back/)).toBeNull()

    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
    api.restoreUser.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'bad email' } },
      message: 'Bad request',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Restore gone@example.com' }))
    fireEvent.change(screen.getByLabelText('New account email'), {
      target: { value: 'not-an-email' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(api.restoreUser).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByText(
        /Restore of gone@example.com failed — That email address isn't valid\./,
      ),
    ).toBeTruthy()
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

describe('BackupSection previous accounts', () => {
  beforeEach(() => {
    api.getBackupOverview.mockResolvedValue([matched])
  })

  it('renders the live row from its own status and the previous account as a sub-row', async () => {
    render(<BackupSection />)
    expect(await screen.findByText('admin@example.com')).toBeTruthy()

    // The live email appears exactly once — no separate orphan row for the matched backup.
    expect(screen.getAllByText('admin@example.com')).toHaveLength(1)
    expect(screen.getByText('Previous account')).toBeTruthy()
    expect(screen.queryByText('Deleted user')).toBeNull()
    // The previous account never counts as the live account's own backup.
    expect(screen.getByText('0 of 1 backed up · 48 assets pending')).toBeTruthy()

    const row = screen.getByText('admin@example.com').closest('tr') as HTMLElement
    // Status / counts / last backup all come from the row's own (missing) backup.
    expect(within(row).getByText('None')).toBeTruthy()
    expect(within(row).getAllByText('0')).toHaveLength(2)
    expect(within(row).getByText('48')).toBeTruthy()
    expect(within(row).getByText('—')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Back up admin@example.com' })).toBeTruthy()
    expect(
      within(row).getByRole('button', { name: 'Delete backup for admin@example.com' }),
    ).toBeTruthy()
    // Restore and Merge belong to the sub-row, never the live row itself.
    expect(
      within(row).queryByRole('button', { name: 'Restore to a new account admin@example.com' }),
    ).toBeNull()
    expect(
      within(row).queryByRole('button', {
        name: 'Merge to current live account admin@example.com',
      }),
    ).toBeNull()

    const subRow = screen.getByText('Previous account').closest('tr') as HTMLElement
    expect(subRow).not.toBe(row)
    // The sub-row never repeats the raw live email; the prefix is URL-encoded.
    expect(within(subRow).queryByText('admin@example.com')).toBeNull()
    expect(within(subRow).getByText('backups/admin%40legacy.example.com__u-legacy/')).toBeTruthy()
    // The stats table spans the sub-row with six evenly sized columns.
    const stats = within(subRow).getByRole('table')
    expect(stats.className).toContain('w-full')
    expect(stats.className).toContain('table-fixed')
    for (const label of ['Assets', 'Files', 'Albums', 'Shares', 'People', 'Last backup']) {
      expect(within(stats).getByText(label).className).toContain('w-1/6')
    }
    expect(within(subRow).getByText('3')).toBeTruthy()
    expect(within(subRow).getByText('4')).toBeTruthy()
    expect(within(subRow).getAllByText('0')).toHaveLength(2)
    expect(within(subRow).getByText('1')).toBeTruthy()

    expect(within(subRow).getByText('Merge to current live account')).toBeTruthy()
    const merge = within(subRow).getByRole('button', {
      name: 'Merge to current live account admin@example.com',
    })
    // PrimaryButton takes no title prop — the hover title rides on the wrapper span.
    const mergeWrap = merge.parentElement!
    expect(mergeWrap.title).toBe('Merge this backup into admin@example.com')
    expect(within(subRow).getByText('Restore to a new account')).toBeTruthy()
    const restore = within(subRow).getByRole('button', {
      name: 'Restore to a new account admin@example.com',
    })
    expect(restore.title).toBe('Restore this backup as a separate account')

    // Actions sit right-aligned and wrap: filled merge, outlined restore, red-outlined delete.
    const actions = mergeWrap.parentElement!
    expect(actions.className).toContain('flex-wrap')
    expect(actions.className).toContain('items-center')
    expect(actions.className).toContain('justify-end')
    expect(actions.className).toContain('gap-2')
    expect(merge.className).toContain('bg-primary-container')
    expect(merge.className).toContain('shadow-sm')
    expect(restore.className).toContain('border-primary/50')
    expect(restore.className).toContain('hover:bg-primary/10')
    const subDelete = within(subRow).getByRole('button', {
      name: 'Delete previous backup for admin@example.com',
    })
    expect(subDelete.title).toBe('Delete previous backup for admin@example.com')
    expect(subDelete.className).toContain('border-status-error/40')
    expect(subDelete.className).toContain('hover:bg-status-error/10')
  })

  it('confirms a merge, calls mergeBackup with the live/source ids and refetches', async () => {
    render(<BackupSection />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Merge to current live account admin@example.com',
      }),
    )

    expect(screen.getByText('Merge backup into admin@example.com?')).toBeTruthy()
    // The copy names the live account the library lands in.
    expect(screen.getByText(/inside the live account admin@example\.com/)).toBeTruthy()
    // The sub-row and the dialog both show the source prefix.
    expect(
      screen.getAllByText('backups/admin%40legacy.example.com__u-legacy/').length,
    ).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/3 assets, 4 files, 0 albums, 0 shares and 1 people/)).toBeTruthy()
    expect(screen.getByText(/password, role and display name/)).toBeTruthy()
    // The dialog promises the snapshot moves into the live backup and the sub-row goes away.
    expect(screen.getByText(/moved into the live account's own S3 backup/)).toBeTruthy()
    expect(
      screen.getByText(/the live backup is updated \(or created if it had none\)/),
    ).toBeTruthy()
    expect(screen.getByText(/this previous-account entry disappears/)).toBeTruthy()
    expect(screen.getByText(/Duplicate photos are linked/)).toBeTruthy()
    expect(screen.getByText(/cleanup-orphans paused/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    await waitFor(() =>
      expect(api.mergeBackup).toHaveBeenCalledWith({
        targetEmailOrId: 'u-live',
        backupUserId: 'u-legacy',
        prefix: 'backups/admin%40legacy.example.com__u-legacy/',
      }),
    )
    expect(
      await screen.findByText(
        'Merged 48 assets (5 already present) into admin@example.com. 2 share links skipped on conflict. The backup now belongs to admin@example.com.',
      ),
    ).toBeTruthy()
    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
  })

  it('refetches after a merge so the live row turns into Backed up and the sub-row disappears', async () => {
    const adopted: BackupOverviewRow = {
      userId: 'u-live',
      email: 'admin@example.com',
      role: 'admin',
      totalAssets: 48,
      backedUpAssets: 48,
      backedUpFiles: 52,
      backedUpAt: mergeResult.backedUpAt,
      exists: true,
      notBackedUp: 0,
      deleted: false,
      prefix: 'backups/admin%40example.com__u-live/',
    }
    api.getBackupOverview.mockResolvedValueOnce([matched]).mockResolvedValue([adopted])

    render(<BackupSection />)
    expect(await screen.findByText('Previous account')).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'Merge to current live account admin@example.com' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Previous account')).toBeNull())

    const row = screen.getByText('admin@example.com').closest('tr') as HTMLElement
    expect(within(row).getByText('Backed up')).toBeTruthy()
    expect(within(row).getByText('48')).toBeTruthy()
    expect(within(row).getByText('52')).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: 'Merge to current live account admin@example.com',
      }),
    ).toBeNull()
  })

  it('warns that the backup could not be moved when the merge returns no assignment', async () => {
    api.mergeBackup.mockResolvedValue({
      ...mergeResult,
      assigned: null,
      adoptionError: 's3 unavailable',
    })

    render(<BackupSection />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Merge to current live account admin@example.com',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    expect(
      await screen.findByText(
        'Merged 48 assets (5 already present) into admin@example.com. 2 share links skipped on conflict. The library merged, but the backup could not be moved — retry the merge.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/The backup now belongs to/)).toBeNull()
    // The source snapshot stays, so the merge can be retried after the store recovers.
    await waitFor(() => expect(api.getBackupOverview).toHaveBeenCalledTimes(2))
  })

  it('notes the leftover snapshot copy when the source cleanup failed', async () => {
    api.mergeBackup.mockResolvedValue({
      ...mergeResult,
      assigned: {
        prefix: 'backups/admin%40example.com__u-live/',
        copiedObjects: 7,
        reusedObjects: 3,
        unionedWithExisting: false,
        sourceDeleted: false,
      },
    })

    render(<BackupSection />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Merge to current live account admin@example.com',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    expect(
      await screen.findByText(
        /The backup now belongs to admin@example.com, but the old snapshot copy could not be removed\./,
      ),
    ).toBeTruthy()
  })

  it('restores the previous account by its snapshot user id', async () => {
    render(<BackupSection />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Restore to a new account admin@example.com' }),
    )

    expect(screen.getByText('Restore admin@example.com?')).toBeTruthy()
    expect(
      screen.getByText(/creates a separate account and does not change the live account/),
    ).toBeTruthy()
    expect(
      screen.getAllByText('backups/admin%40legacy.example.com__u-legacy/').length,
    ).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/3 assets and 4 files/)).toBeTruthy()
    // Empty input restores under the backup address.
    const emailField = screen.getByLabelText<HTMLInputElement>('New account email')
    expect(emailField.value).toBe('')
    expect(emailField.getAttribute('placeholder')).toBe('admin@legacy.example.com')
    // The address ask is focused on open, so the dialog reads as the question it asks.
    expect(document.activeElement).toBe(emailField)
    expect(screen.getByText(/Leave empty to use the backup address/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(api.restoreUser).toHaveBeenCalledWith('u-legacy', undefined))
  })

  it('restores a previous account under a typed email and toasts the API result', async () => {
    api.restoreUser.mockResolvedValue({
      ...restoreResult,
      userId: 'u-legacy',
      email: 'new@example.com',
    })
    render(<BackupSection />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Restore to a new account admin@example.com' }),
    )

    fireEvent.change(screen.getByLabelText('New account email'), {
      target: { value: '  new@example.com  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(api.restoreUser).toHaveBeenCalledWith('u-legacy', 'new@example.com'))
    expect(await screen.findByText(/Restored new@example.com — 40 assets, 55 files/)).toBeTruthy()
    expect(screen.getByText(/Sign in as new@example.com/)).toBeTruthy()
  })

  it('deletes the previous-account backup by its snapshot user id', async () => {
    render(<BackupSection />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete previous backup for admin@example.com' }),
    )

    expect(screen.getByText('Delete backup for admin@example.com?')).toBeTruthy()
    expect(
      screen.getAllByText('backups/admin%40legacy.example.com__u-legacy/').length,
    ).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/3 assets and 4 files/)).toBeTruthy()
    expect(screen.getByText(/The live account and any merged photos stay/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete backup' }))

    await waitFor(() => expect(api.deleteBackup).toHaveBeenCalledWith('u-legacy'))
  })

  it('dates extra previous-account snapshots and routes their actions', async () => {
    api.getBackupOverview.mockResolvedValue([
      { ...matched, legacyBackups: [legacySnap, olderSnap] },
    ])
    const when = new Date(olderSnap.backedUpAt!).toLocaleString()
    render(<BackupSection />)
    expect(await screen.findByText('admin@example.com')).toBeTruthy()

    // The first snapshot keeps the short labels; later ones append their backup date.
    expect(
      screen.getByRole('button', {
        name: 'Merge to current live account admin@example.com',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Restore to a new account admin@example.com' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Delete previous backup for admin@example.com' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: `Merge to current live account admin@example.com (${when})`,
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: `Restore to a new account admin@example.com (${when})` }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: `Delete previous backup for admin@example.com from ${when}`,
      }),
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', {
        name: `Merge to current live account admin@example.com (${when})`,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() =>
      expect(api.mergeBackup).toHaveBeenCalledWith({
        targetEmailOrId: 'u-live',
        backupUserId: 'u-legacy-old',
        prefix: olderSnap.prefix,
      }),
    )
  })

  it('routes extra-snapshot restore and delete to the snapshot user id', async () => {
    api.getBackupOverview.mockResolvedValue([
      { ...matched, legacyBackups: [legacySnap, olderSnap] },
    ])
    const when = new Date(olderSnap.backedUpAt!).toLocaleString()
    render(<BackupSection />)
    expect(await screen.findByText('admin@example.com')).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', {
        name: `Restore to a new account admin@example.com (${when})`,
      }),
    )
    expect(screen.getByText(`Restore admin@example.com from ${when}?`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(api.restoreUser).toHaveBeenCalledWith('u-legacy-old', undefined))

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Delete previous backup for admin@example.com from ${when}`,
      }),
    )
    expect(screen.getByText('Delete previous backup for admin@example.com?')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete backup' }))
    await waitFor(() => expect(api.deleteBackup).toHaveBeenCalledWith('u-legacy-old'))
  })

  it('hides Merge for an already-merged previous snapshot and shows the merged date', async () => {
    const mergedAt = '2026-10-07T00:00:00.000Z'
    api.getBackupOverview.mockResolvedValue([
      { ...matched, legacyBackups: [{ ...legacySnap, mergedAt }] },
    ])
    render(<BackupSection />)
    expect(await screen.findByText('admin@example.com')).toBeTruthy()

    expect(
      screen.queryByRole('button', {
        name: 'Merge to current live account admin@example.com',
      }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Restore to a new account admin@example.com' }),
    ).toBeTruthy()
    expect(screen.getByText(`Merged ${new Date(mergedAt).toLocaleString()}`)).toBeTruthy()
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
