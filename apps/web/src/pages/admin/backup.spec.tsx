import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { BackupOverviewRow, BackupResult } from '../../api/admin'

const api = vi.hoisted(() => ({
  loadBackupOverview: vi.fn(),
  getBackupProgress: vi.fn(),
  backupUser: vi.fn(),
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

const notFound = () => ({ isAxiosError: true, response: { status: 404 }, message: 'Not found' })

beforeEach(() => {
  api.loadBackupOverview.mockResolvedValue({ rows: [ada, grace], fallback: false })
  api.getBackupProgress.mockRejectedValue(notFound())
  api.backupUser.mockResolvedValue(result)
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
    expect(api.loadBackupOverview).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('Filter backups by email'), {
      target: { value: 'grace' },
    })

    expect(screen.queryByText('ada@example.com')).toBeNull()
    expect(screen.getByText('grace@example.com')).toBeTruthy()
    expect(api.loadBackupOverview).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Showing 1 of 1 user')).toBeTruthy()
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
    api.loadBackupOverview.mockResolvedValue({
      rows: [
        { ...ada, degraded: 'unreadable' },
        { ...grace, degraded: 'corrupt', exists: true },
      ],
      fallback: false,
    })

    render(<BackupSection />)
    expect(await screen.findByText('Unreadable')).toBeTruthy()
    expect(screen.getByText('Corrupt')).toBeTruthy()
    expect(screen.getAllByText(/rerun the backup/i).length).toBe(2)
  })

  it('maps a 503 overview load to the Floci copy with a retry', async () => {
    api.loadBackupOverview.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503 },
      message: 'Request failed with status code 503',
    })

    render(<BackupSection />)
    expect(await screen.findByText("Can't reach backup storage")).toBeTruthy()
    expect(screen.getByText(/Floci is running/)).toBeTruthy()
    expect(screen.queryByText('Request failed with status code 503')).toBeNull()

    api.loadBackupOverview.mockResolvedValue({ rows: [ada], fallback: false })
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
    api.loadBackupOverview.mockResolvedValue({
      rows: [{ ...ada, email: 'Ada@Example.COM' }],
      fallback: false,
    })

    render(<BackupSection />)
    expect(await screen.findByText('Ada@Example.COM')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back up Ada@Example.COM' }))
    expect(screen.getByText('Back up Ada@Example.COM?')).toBeTruthy()
    expect(screen.getByText('backups/ada%40example.com__u-1/')).toBeTruthy()
  })
})
