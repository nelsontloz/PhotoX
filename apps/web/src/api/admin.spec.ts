import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FaceDetectionSettings } from '@photox/shared-types'

const { getMock, postMock, deleteMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  deleteMock: vi.fn(),
  patchMock: vi.fn(),
}))

vi.mock('./client', () => ({
  api: { get: getMock, post: postMock, delete: deleteMock, patch: patchMock },
}))

import {
  getFaceDetection,
  reprocessPipeline,
  getPipelineStatus,
  reclusterFaces,
  backupUser,
  restoreUser,
  deleteBackup,
  getBackupOverview,
  backupPrefixPreview,
  deleteAdminUser,
  getAdminUserDeleteStatus,
  pollAdminUserDelete,
  updateAdminUser,
  syncAdminUserBackup,
  type BackupResult,
  type FaceReprocessResponse,
  type FacePipelineRun,
} from './admin'

const settings: FaceDetectionSettings = {
  modelAvailable: false,
}

describe('face detection admin API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getFaceDetection reads the face-detection endpoint', async () => {
    getMock.mockResolvedValue({ data: settings })
    await expect(getFaceDetection()).resolves.toEqual(settings)
    expect(getMock).toHaveBeenCalledWith('/v1/admin/face-detection')
  })

  it('reprocessPipeline posts without a body', async () => {
    postMock.mockResolvedValue({ data: { enqueued: 5, total: 5 } })
    await reprocessPipeline<FaceReprocessResponse>('faces')
    expect(postMock).toHaveBeenCalledWith('/v1/admin/faces/reprocess')
  })

  it('getPipelineStatus reads last run and queue counts', async () => {
    const status = {
      lastRun: { startedAt: '2026-10-01T00:00:00.000Z', total: 5, enqueued: 5 },
      queue: { waiting: 1, active: 0, completed: 4, failed: 0, delayed: 0 },
    }
    getMock.mockResolvedValue({ data: status })
    await expect(getPipelineStatus<FacePipelineRun>('faces')).resolves.toEqual(status)
    expect(getMock).toHaveBeenCalledWith('/v1/admin/faces/reprocess')
  })

  it('reclusterFaces posts to the recluster endpoint', async () => {
    postMock.mockResolvedValue({ data: { enqueued: 2 } })
    await expect(reclusterFaces()).resolves.toEqual({ enqueued: 2 })
    expect(postMock).toHaveBeenCalledWith('/v1/admin/faces/recluster')
  })
})

describe('user backup admin API', () => {
  beforeEach(() => vi.clearAllMocks())

  const result: BackupResult = {
    userId: 'u-1',
    email: 'ada@example.com',
    prefix: 'backups/ada@example.com__u-1/',
    backedUpAt: '2026-10-01T00:00:00.000Z',
    files: 3,
    uploaded: 1,
    skipped: 2,
    assets: 2,
    albums: 1,
    shares: 0,
    persons: 1,
  }

  it('backupUser posts the emailOrId with a timeout sized for inline S3 copies', async () => {
    postMock.mockResolvedValue({ data: result })
    await expect(backupUser('u-1')).resolves.toEqual(result)
    expect(postMock).toHaveBeenCalledWith(
      '/v1/admin/backups',
      { emailOrId: 'u-1' },
      { timeout: 600_000 },
    )
  })

  it('restoreUser posts the emailOrId with the long inline timeout', async () => {
    const restored = {
      userId: 'u-3',
      email: 'gone@example.com',
      prefix: 'backups/gone@example.com__u-3/',
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
        prefix: 'backups/gone@example.com__u-3/',
        manifestObjectKey: 'backups/gone@example.com__u-3/manifest.json',
      },
      startedAt: '2026-10-04T00:00:00.000Z',
      completedAt: '2026-10-04T00:01:00.000Z',
      enqueued: { metadata: 40, thumbnails: 40, videos: 0, faces: 40, ai: 0 },
    }
    postMock.mockResolvedValue({ data: restored })
    await expect(restoreUser('u-3')).resolves.toEqual(restored)
    expect(postMock).toHaveBeenCalledWith(
      '/v1/admin/restores',
      { emailOrId: 'u-3' },
      { timeout: 600_000 },
    )
  })

  it('deleteBackup issues DELETE with emailOrId as a query param', async () => {
    const deleted = {
      userId: 'u-1',
      email: 'ada@example.com',
      prefix: 'backups/ada%40example.com__u-1/',
      deletedObjects: 125,
    }
    deleteMock.mockResolvedValue({ data: deleted })
    await expect(deleteBackup('u-1')).resolves.toEqual(deleted)
    expect(deleteMock).toHaveBeenCalledWith('/v1/admin/backups', {
      params: { emailOrId: 'u-1' },
    })
  })

  it('getBackupOverview passes orphan rows through untouched', async () => {
    const rows = [
      {
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
      },
      {
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
      },
    ]
    getMock.mockResolvedValue({ data: rows })
    await expect(getBackupOverview()).resolves.toEqual(rows)
    expect(getMock).toHaveBeenCalledWith('/v1/admin/backups/overview', { timeout: 30_000 })
  })
})

describe('admin user deletion API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deleteAdminUser passes the 202 body through untouched', async () => {
    const accepted = {
      jobId: 'job-1',
      userId: 'u-1',
      backupKept: true as const,
      backupPrefix: 'backups/ada%40example.com__u-1/',
    }
    deleteMock.mockResolvedValue({ data: accepted })
    await expect(deleteAdminUser('u-1')).resolves.toEqual(accepted)
    expect(deleteMock).toHaveBeenCalledWith('/v1/admin/users/u-1')
  })

  it('getAdminUserDeleteStatus reads :id/delete-status and maps state to status', async () => {
    getMock.mockResolvedValue({
      data: {
        userId: 'u-1',
        jobId: 'user-delete-u-1',
        state: 'active',
        backupKept: true,
        backupPrefix: 'backups/ada%40example.com__u-1/',
        queue: {},
      },
    })
    await expect(getAdminUserDeleteStatus('u-1')).resolves.toEqual({
      status: 'active',
      error: null,
    })
    expect(getMock).toHaveBeenCalledWith('/v1/admin/users/u-1/delete-status')
  })

  it('pollAdminUserDelete returns once the job completes', async () => {
    getMock
      .mockResolvedValueOnce({
        data: {
          userId: 'u-1',
          jobId: 'user-delete-u-1',
          state: 'active',
          backupKept: true,
          backupPrefix: 'backups/ada%40example.com__u-1/',
          queue: {},
        },
      })
      .mockResolvedValueOnce({
        data: {
          userId: 'u-1',
          jobId: 'user-delete-u-1',
          state: 'completed',
          backupKept: true,
          backupPrefix: 'backups/ada%40example.com__u-1/',
          queue: {},
        },
      })
    await pollAdminUserDelete('u-1', { intervalMs: 1 })
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('pollAdminUserDelete throws the server error when the job fails', async () => {
    getMock.mockResolvedValue({
      data: {
        userId: 'u-1',
        jobId: 'user-delete-u-1',
        state: 'failed',
        backupKept: true,
        backupPrefix: 'backups/ada%40example.com__u-1/',
        queue: {},
        error: 'disk full',
      },
    })
    await expect(pollAdminUserDelete('u-1', { intervalMs: 1 })).rejects.toThrow('disk full')
  })

  it('pollAdminUserDelete times out on a stuck job', async () => {
    getMock.mockResolvedValue({
      data: {
        userId: 'u-1',
        jobId: 'user-delete-u-1',
        state: 'active',
        backupKept: true,
        backupPrefix: 'backups/ada%40example.com__u-1/',
        queue: {},
      },
    })
    await expect(pollAdminUserDelete('u-1', { intervalMs: 1, timeoutMs: 5 })).rejects.toThrow(
      /Timed out/,
    )
  })

  it('pollAdminUserDelete keeps polling on unknown states instead of misreading them', async () => {
    getMock
      .mockResolvedValueOnce({
        data: {
          userId: 'u-1',
          jobId: 'user-delete-u-1',
          state: 'canceled',
          backupKept: true,
          backupPrefix: 'backups/ada%40example.com__u-1/',
          queue: {},
        },
      })
      .mockResolvedValueOnce({
        data: {
          userId: 'u-1',
          jobId: 'user-delete-u-1',
          state: 'completed',
          backupKept: true,
          backupPrefix: 'backups/ada%40example.com__u-1/',
          queue: {},
        },
      })
    await pollAdminUserDelete('u-1', { intervalMs: 1 })
    expect(getMock).toHaveBeenCalledTimes(2)
  })
})

describe('admin user account edit API', () => {
  beforeEach(() => vi.clearAllMocks())

  const updated = {
    user: {
      id: 'u 1',
      displayName: 'Ada L.',
      email: 'ada.l@example.com',
      role: 'admin' as const,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
    },
    backup: {
      synced: true,
      moved: true,
      from: 'backups/ada%40example.com__u%201/',
      to: 'backups/ada.l%40example.com__u%201/',
    },
  }

  it('updateAdminUser patches the encoded id with the changed fields only', async () => {
    patchMock.mockResolvedValue({ data: updated })
    await expect(updateAdminUser('u 1', { displayName: 'Ada L.' })).resolves.toEqual(updated)
    expect(patchMock).toHaveBeenCalledWith('/v1/admin/users/u%201', { displayName: 'Ada L.' }, {})
  })

  it('updateAdminUser gives an email change the long backup-move timeout', async () => {
    patchMock.mockResolvedValue({ data: updated })
    await updateAdminUser('u-1', { email: 'ada.l@example.com', password: 'correcthorse' })
    expect(patchMock).toHaveBeenCalledWith(
      '/v1/admin/users/u-1',
      { email: 'ada.l@example.com', password: 'correcthorse' },
      { timeout: 600_000 },
    )
  })

  it('syncAdminUserBackup posts to :id/backup-sync with the long timeout and no body', async () => {
    const outcome = { synced: false, moved: false, to: 'backups/x%40y__u-1/', error: 'S3 down' }
    postMock.mockResolvedValue({ data: outcome })
    await expect(syncAdminUserBackup('u-1')).resolves.toEqual(outcome)
    expect(postMock).toHaveBeenCalledWith('/v1/admin/users/u-1/backup-sync', undefined, {
      timeout: 600_000,
    })
  })
})

describe('backupPrefixPreview', () => {
  it('encodes @ and lowercases/trims the email like backupPrefix', () => {
    expect(backupPrefixPreview('ada@example.com', 'u-1')).toBe('backups/ada%40example.com__u-1/')
  })

  it('trims whitespace and lowercases uppercase emails before encoding', () => {
    expect(backupPrefixPreview('  Ada@Example.COM  ', 'u-1')).toBe(
      'backups/ada%40example.com__u-1/',
    )
  })

  it('encodes the userId segment', () => {
    expect(backupPrefixPreview('ada@example.com', 'u 1/x')).toBe(
      'backups/ada%40example.com__u%201%2Fx/',
    )
  })
})
