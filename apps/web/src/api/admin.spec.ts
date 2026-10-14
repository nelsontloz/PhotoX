import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FaceDetectionSettings } from '@photox/shared-types'

const { getMock, putMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
  postMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('./client', () => ({
  api: { get: getMock, put: putMock, post: postMock, delete: deleteMock },
}))

import {
  getFaceDetection,
  setFaceDetector,
  reprocessPipeline,
  getPipelineStatus,
  reclusterFaces,
  backupUser,
  getBackupStatus,
  backupPrefixPreview,
  deleteAdminUser,
  getAdminUserDeleteStatus,
  pollAdminUserDelete,
  getAdminUserDeletePreview,
  type BackupResult,
  type FaceReprocessResponse,
  type FacePipelineRun,
} from './admin'

const settings: FaceDetectionSettings = {
  detector: 'human',
  envDefault: 'human',
  models: { scrfd: false },
  facesByDetector: { human: 3, scrfd: 2, unset: 1 },
}

describe('face detection admin API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getFaceDetection reads the face-detection endpoint', async () => {
    getMock.mockResolvedValue({ data: settings })
    await expect(getFaceDetection()).resolves.toEqual(settings)
    expect(getMock).toHaveBeenCalledWith('/v1/admin/face-detection')
  })

  it('setFaceDetector puts the chosen detector and returns the new state', async () => {
    putMock.mockResolvedValue({ data: { ...settings, detector: 'scrfd' } })
    await expect(setFaceDetector('scrfd')).resolves.toEqual({
      ...settings,
      detector: 'scrfd',
    })
    expect(putMock).toHaveBeenCalledWith('/v1/admin/face-detection', { detector: 'scrfd' })
  })

  it('reprocessPipeline posts without a body', async () => {
    postMock.mockResolvedValue({ data: { enqueued: 5, total: 5, detector: 'human' } })
    await reprocessPipeline<FaceReprocessResponse>('faces')
    expect(postMock).toHaveBeenCalledWith('/v1/admin/faces/reprocess')
  })

  it('getPipelineStatus reads last run and queue counts', async () => {
    const status = {
      lastRun: { startedAt: '2026-10-01T00:00:00.000Z', total: 5, enqueued: 5, detector: 'human' },
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

  it('getBackupStatus reads the status endpoint with emailOrId as a query param', async () => {
    const status = {
      exists: true,
      userId: 'u-1',
      emailAtBackup: 'ada@example.com',
      backedUpAt: '2026-10-01T00:00:00.000Z',
      files: 3,
      assets: 2,
    }
    getMock.mockResolvedValue({ data: status })
    await expect(getBackupStatus('ada@example.com')).resolves.toEqual(status)
    expect(getMock).toHaveBeenCalledWith('/v1/admin/backups/status', {
      params: { emailOrId: 'ada@example.com' },
      timeout: 30_000,
    })
  })

  it('getBackupStatus surfaces the empty-manifest shape for a user with no backup', async () => {
    getMock.mockResolvedValue({ data: { exists: false } })
    await expect(getBackupStatus('u-9')).resolves.toEqual({ exists: false })
  })
})

describe('admin user deletion API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deleteAdminUser issues DELETE for the encoded user id', async () => {
    deleteMock.mockResolvedValue({ data: { jobId: 'job-1' } })
    await expect(deleteAdminUser('u-1')).resolves.toEqual({ jobId: 'job-1' })
    expect(deleteMock).toHaveBeenCalledWith('/v1/admin/users/u-1')
  })

  it('deleteAdminUser tolerates an empty synchronous body', async () => {
    deleteMock.mockResolvedValue({ data: '' })
    await expect(deleteAdminUser('u-1')).resolves.toEqual({})
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

  it('getAdminUserDeletePreview maps a 404 to null for older cores', async () => {
    getMock.mockRejectedValue({ isAxiosError: true, response: { status: 404 } })
    await expect(getAdminUserDeletePreview('u-1')).resolves.toBeNull()
    expect(getMock).toHaveBeenCalledWith('/v1/admin/users/u-1/delete-preview')
  })

  it('getAdminUserDeletePreview rethrows non-404 failures', async () => {
    getMock.mockRejectedValue({ isAxiosError: true, response: { status: 503 } })
    await expect(getAdminUserDeletePreview('u-1')).rejects.toMatchObject({
      response: { status: 503 },
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
