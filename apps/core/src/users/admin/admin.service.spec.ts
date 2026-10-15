import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { backupPrefix } from '@photox/shared-config'
import { S3BackupService } from '../../backup/s3-backup.service'
import { isWorkerAllowedRoute } from '../../auth/open-routes'
import { AdminService } from './admin.service'

const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_EMAIL = 'target@example.com'

function makeService(opts?: {
  user?: { id: string; email: string; role: 'user' | 'admin' } | null
  adminCount?: number
  enqueueResult?: boolean
  job?: { getState: () => Promise<string>; data: unknown } | null
  progress?: { jobId: string; state: 'completed' } | undefined
}) {
  const userRepo = {
    findOne: vi.fn().mockResolvedValue(opts?.user === undefined ? null : opts.user),
    count: vi.fn().mockResolvedValue(opts?.adminCount ?? 2),
  }
  const queue = {
    getJob: vi.fn().mockResolvedValue(opts?.job === undefined ? null : opts.job),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0 }),
  }
  const bullMq = {
    enqueue: vi.fn().mockResolvedValue(opts?.enqueueResult ?? true),
    getQueue: vi.fn().mockReturnValue(queue),
  }
  const deletes = {
    computeBackupPrefix: (email: string, id: string) => backupPrefix(email, id),
    clearFinishedJob: vi.fn().mockResolvedValue(false),
    drainUserJobs: vi.fn().mockResolvedValue(0),
    markQueued: vi.fn(),
    getProgress: vi.fn().mockReturnValue(
      opts?.progress
        ? {
            userId: TARGET_ID,
            jobId: `user-delete-${TARGET_ID}`,
            state: opts.progress.state,
            backupPrefix: backupPrefix(TARGET_EMAIL, TARGET_ID),
            updatedAt: new Date().toISOString(),
          }
        : undefined,
    ),
  }
  const service = new AdminService(userRepo as never, bullMq as never, deletes as never)
  return { service, userRepo, bullMq, deletes, queue }
}

const targetUser = { id: TARGET_ID, email: TARGET_EMAIL, role: 'user' as const }

describe('AdminService.requestUserDelete guards', () => {
  it('404s on a missing user', async () => {
    const { service } = makeService({ user: null })
    await expect(service.requestUserDelete(TARGET_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('403s on self-delete without draining or enqueuing', async () => {
    const { service, bullMq, deletes } = makeService({ user: targetUser })
    await expect(service.requestUserDelete(TARGET_ID, TARGET_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(deletes.drainUserJobs).not.toHaveBeenCalled()
    expect(bullMq.enqueue).not.toHaveBeenCalled()
  })

  it('409s when the target is the last admin', async () => {
    const { service, bullMq } = makeService({
      user: { ...targetUser, role: 'admin' },
      adminCount: 1,
    })
    await expect(service.requestUserDelete(TARGET_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      ConflictException,
    )
    expect(bullMq.enqueue).not.toHaveBeenCalled()
  })

  it('allows deleting a non-last admin and skips the count for regular users', async () => {
    const { service, userRepo, bullMq } = makeService({ user: targetUser, adminCount: 5 })
    const res = await service.requestUserDelete(TARGET_ID, ADMIN_ID)
    expect(userRepo.count).not.toHaveBeenCalled()
    expect(res.jobId).toBe(`user-delete-${TARGET_ID}`)
    expect(bullMq.enqueue).toHaveBeenCalledWith(
      'user-delete',
      'user-delete',
      {
        userId: TARGET_ID,
        email: TARGET_EMAIL,
        backupPrefix: backupPrefix(TARGET_EMAIL, TARGET_ID),
      },
      { jobId: `user-delete-${TARGET_ID}`, removeOnComplete: true },
    )
  })

  it('clears a retained finished job before enqueueing so a re-delete is not swallowed', async () => {
    const { service, deletes, bullMq } = makeService({ user: targetUser })
    await service.requestUserDelete(TARGET_ID, ADMIN_ID)
    // BullMQ dedups by jobId: a completed job for a restored account would absorb the
    // add and the UI would poll its stale `completed`
    expect(deletes.clearFinishedJob).toHaveBeenCalledWith(TARGET_ID)
    const clearOrder = deletes.clearFinishedJob.mock.invocationCallOrder[0]!
    const enqueueOrder = bullMq.enqueue.mock.invocationCallOrder[0]!
    expect(clearOrder).toBeLessThan(enqueueOrder)
  })

  it('drains pending user jobs before enqueueing', async () => {
    const { service, deletes, bullMq } = makeService({ user: targetUser })
    await service.requestUserDelete(TARGET_ID, ADMIN_ID)
    const drainOrder = deletes.drainUserJobs.mock.invocationCallOrder[0]!
    const enqueueOrder = bullMq.enqueue.mock.invocationCallOrder[0]!
    expect(drainOrder).toBeLessThan(enqueueOrder)
  })

  it('503s when the enqueue fails', async () => {
    const { service } = makeService({ user: targetUser, enqueueResult: false })
    await expect(service.requestUserDelete(TARGET_ID, ADMIN_ID)).rejects.toMatchObject({
      status: 503,
    })
  })
})

// ponytail: hard-rule pin — user deletion must never mutate S3 backups (no
// listKeys/deleteKeys/deleteKey/copyPrefix, no manifest/originals enumeration)
describe('AdminService.requestUserDelete backup exclusion', () => {
  const S3_MUTATING_METHODS = [
    'listKeys',
    'deleteKeys',
    'deleteKey',
    'copyPrefix',
    'copyKey',
    'putObject',
    'putFile',
    'getBuffer',
    'headObject',
    'downloadToFile',
    'ensureBucket',
  ] as const

  it('makes zero S3 calls and reports the kept prefix', async () => {
    const spies = S3_MUTATING_METHODS.map((m) =>
      vi.spyOn(S3BackupService.prototype, m as never).mockResolvedValue([] as never),
    )
    try {
      const { service } = makeService({ user: targetUser })
      // the services hold no S3 reference at all — exclusion is structural, not behavioral
      expect(service).not.toHaveProperty('s3')
      expect(service).not.toHaveProperty('s3BackupService')
      expect(service).not.toHaveProperty('backupService')

      const res = await service.requestUserDelete(TARGET_ID, ADMIN_ID)

      expect(res.backupKept).toBe(true)
      expect(res.backupPrefix).toBe(backupPrefix(TARGET_EMAIL, TARGET_ID))
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('keeps worker act tokens denied on both delete routes', () => {
    // central JwtAuthGuard denies act-carrying tokens outside the worker job surface —
    // these routes must never be allowlisted
    expect(isWorkerAllowedRoute(`/api/v1/admin/users/${TARGET_ID}`)).toBe(false)
    expect(isWorkerAllowedRoute(`/api/v1/admin/users/${TARGET_ID}/delete-status`)).toBe(false)
  })
})

describe('AdminService.getUserDeleteStatus', () => {
  it('returns the completed run after the user row is gone', async () => {
    const { service } = makeService({ user: null, progress: { jobId: '', state: 'completed' } })
    const res = await service.getUserDeleteStatus(TARGET_ID)
    expect(res.state).toBe('completed')
    expect(res.jobId).toBe(`user-delete-${TARGET_ID}`)
    expect(res.backupKept).toBe(true)
    expect(res.backupPrefix).toBe(backupPrefix(TARGET_EMAIL, TARGET_ID))
    expect(res.queue).toEqual({ waiting: 0 })
  })

  it('maps a live BullMQ job state', async () => {
    const { service } = makeService({
      user: targetUser,
      job: { getState: () => Promise.resolve('active'), data: { backupPrefix: 'backups/kept/' } },
    })
    const res = await service.getUserDeleteStatus(TARGET_ID)
    expect(res.state).toBe('active')
    expect(res.backupPrefix).toBe('backups/kept/')
  })

  it('404s for an unknown user with no recorded run', async () => {
    const { service } = makeService({ user: null })
    await expect(service.getUserDeleteStatus(TARGET_ID)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('reports unknown for a live user with no job and no run', async () => {
    const { service } = makeService({ user: targetUser })
    const res = await service.getUserDeleteStatus(TARGET_ID)
    expect(res.state).toBe('unknown')
  })
})
