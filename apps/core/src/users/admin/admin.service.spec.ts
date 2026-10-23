import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common'
import * as argon2 from 'argon2'
import { QueryFailedError } from 'typeorm'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { backupPrefix } from '@photox/shared-config'
import type { AdminUserBackupSync } from '@photox/shared-types'
import { S3BackupService } from '../../backup/s3-backup.service'
import { isWorkerRoute } from '../../auth/open-routes'
import { User } from '../entities/user.entity'
import { AdminService } from './admin.service'
import { UpdateAdminUserDto } from './dto/update-admin-user.body.dto'

const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_EMAIL = 'target@example.com'
const TARGET_NAME = 'Target User'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'

interface MockUser {
  id: string
  email: string
  displayName: string
  role: 'user' | 'admin'
  passwordHash: string
  tokensValidAfter: Date | null
  createdAt: Date
  updatedAt: Date
}

function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: TARGET_ID,
    email: TARGET_EMAIL,
    displayName: TARGET_NAME,
    role: 'user',
    passwordHash: 'old-hash',
    tokensValidAfter: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError(
    'UPDATE "users" SET "email" = $1',
    ['dup@example.com'],
    Object.assign(new Error('duplicate key value violates unique constraint "UQ_email"'), {
      code: '23505',
    }),
  )
}

const DEFAULT_MOVE: AdminUserBackupSync = {
  synced: true,
  moved: true,
  from: 'backups/target@example.com__2222/',
  to: 'backups/new@example.com__2222/',
}

/** Chainable fake for the case-insensitive email-holder lookup query. */
interface HolderChain {
  where: Mock<(sql: string, params: { email: string }) => HolderChain>
  andWhere: Mock<(sql: string, params: { id: string }) => HolderChain>
  getOne: Mock<() => Promise<{ id: string; email: string } | null>>
}

function makeService(opts?: {
  user?: MockUser | null
  adminCount?: number
  enqueueResult?: boolean
  job?: { getState: () => Promise<string>; data: unknown } | null
  progress?: { jobId: string; state: 'completed' } | undefined
  /** rows the case-insensitive holder lookup may match (the query excludes the target id) */
  emailHolders?: { id: string; email: string }[]
  saveError?: Error
  revokeError?: Error
  moveResult?: AdminUserBackupSync
  moveError?: Error
}) {
  // transaction-scoped EntityManager fake: the service must save through the SAME
  // manager it runs the revocation on, and a rejection must propagate to the caller
  const txSave = vi.fn((u: unknown) =>
    opts?.saveError ? Promise.reject(opts.saveError) : Promise.resolve(u),
  )
  const txManager = {
    save: txSave,
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
  }
  const transaction = vi.fn((cb: (m: typeof txManager) => Promise<unknown>) => cb(txManager))

  // stands in for `WHERE LOWER(u.email) = LOWER(:email) AND u.id != :id`: the fake
  // applies exactly the predicate the code passes (case-insensitive, own row out)
  const holderParams: { email?: string; id?: string } = {}
  const holderChain: HolderChain = {
    where: vi.fn((_sql: string, params: { email: string }) => {
      holderParams.email = params.email
      return holderChain
    }),
    andWhere: vi.fn((_sql: string, params: { id: string }) => {
      holderParams.id = params.id
      return holderChain
    }),
    getOne: vi.fn(() => {
      const wanted = holderParams.email?.trim().toLowerCase()
      const hit = (opts?.emailHolders ?? []).find(
        (h) => h.id !== holderParams.id && h.email.trim().toLowerCase() === wanted,
      )
      return Promise.resolve(hit ?? null)
    }),
  }

  const userRepo = {
    // updateUser saves through the transaction's manager, never this repository
    manager: { transaction },
    // every live-lookup in the tested paths is by id; the holder scan uses the qb below
    findOne: vi.fn(() => Promise.resolve(opts?.user ?? null)),
    count: vi.fn().mockResolvedValue(opts?.adminCount ?? 2),
    createQueryBuilder: vi.fn(() => holderChain),
  }
  const queue = {
    getJob: vi.fn().mockResolvedValue(opts?.job === undefined ? null : opts.job),
  }
  const bullMq = {
    enqueue: vi.fn().mockResolvedValue(opts?.enqueueResult ?? true),
    getQueue: vi.fn().mockReturnValue(queue),
  }
  const deletes = {
    clearFinishedJob: vi.fn().mockResolvedValue(false),
    setProgress: vi.fn(),
    getProgress: vi.fn().mockReturnValue(
      opts?.progress
        ? {
            jobId: `user-delete-${TARGET_ID}`,
            state: opts.progress.state,
            backupPrefix: backupPrefix(TARGET_EMAIL, TARGET_ID),
          }
        : undefined,
    ),
  }
  const auth = {
    revokeAllSessions: vi.fn(() =>
      opts?.revokeError ? Promise.reject(opts.revokeError) : Promise.resolve(undefined),
    ),
  }
  const backups = {
    moveBackupPrefix: vi.fn(() =>
      opts?.moveError
        ? Promise.reject(opts.moveError)
        : Promise.resolve(opts?.moveResult ?? DEFAULT_MOVE),
    ),
  }
  const service = new AdminService(
    userRepo as never,
    bullMq as never,
    deletes as never,
    auth as never,
    backups as never,
  )
  return {
    service,
    userRepo,
    bullMq,
    deletes,
    auth,
    backups,
    queue,
    tx: txManager,
    holderChain,
  }
}

const targetUser = makeUser()

describe('AdminService.requestUserDelete guards', () => {
  it('404s on a missing user', async () => {
    const { service } = makeService({ user: null })
    await expect(service.requestUserDelete(TARGET_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('403s on self-delete without enqueuing', async () => {
    const { service, bullMq } = makeService({ user: targetUser })
    await expect(service.requestUserDelete(TARGET_ID, TARGET_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    )
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

  it('503s when the enqueue fails', async () => {
    const { service } = makeService({ user: targetUser, enqueueResult: false })
    await expect(service.requestUserDelete(TARGET_ID, ADMIN_ID)).rejects.toMatchObject({
      status: 503,
    })
  })
})

// ponytail: hard-rule pin — user deletion must never mutate S3 backups (no
// listKeys/deleteKeys/copyPrefix, no manifest/originals enumeration)
describe('AdminService.requestUserDelete backup exclusion', () => {
  const S3_MUTATING_METHODS = [
    'listKeys',
    'deleteKeys',
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
    const s3Proto = S3BackupService.prototype as unknown as Record<
      string,
      (...args: never[]) => Promise<unknown>
    >
    const spies = S3_MUTATING_METHODS.map((m) => vi.spyOn(s3Proto, m).mockResolvedValue([]))
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

  it('keeps worker act tokens denied on both delete routes and the backup-sync retry', () => {
    // central JwtAuthGuard denies act-carrying tokens outside the worker job surface —
    // these routes must never be allowlisted
    expect(isWorkerRoute(`/api/v1/admin/users/${TARGET_ID}`)).toBe(false)
    expect(isWorkerRoute(`/api/v1/admin/users/${TARGET_ID}/delete-status`)).toBe(false)
    expect(isWorkerRoute(`/api/v1/admin/users/${TARGET_ID}/backup-sync`)).toBe(false)
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

describe('AdminService.updateUser', () => {
  it('404s on an unknown user', async () => {
    const { service } = makeService({ user: null })
    await expect(
      service.updateUser(TARGET_ID, { displayName: 'Renamed' }, ADMIN_ID),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('400s when the patch would change nothing', async () => {
    const { service, userRepo, tx, auth, backups } = makeService({ user: makeUser() })
    await expect(service.updateUser(TARGET_ID, {}, ADMIN_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(
      service.updateUser(
        TARGET_ID,
        { displayName: `  ${TARGET_NAME}  `, email: TARGET_EMAIL.toUpperCase() },
        ADMIN_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(userRepo.manager.transaction).not.toHaveBeenCalled()
    expect(tx.save).not.toHaveBeenCalled()
    expect(auth.revokeAllSessions).not.toHaveBeenCalled()
    expect(backups.moveBackupPrefix).not.toHaveBeenCalled()
  })

  it('400s on a displayName that is blank after trimming', async () => {
    const { service, tx } = makeService({ user: makeUser() })
    await expect(
      service.updateUser(TARGET_ID, { displayName: '   ' }, ADMIN_ID),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.save).not.toHaveBeenCalled()
  })

  it('409s when another user already holds the email', async () => {
    const { service, tx, auth, backups } = makeService({
      user: makeUser(),
      emailHolders: [{ id: OTHER_ID, email: 'taken@example.com' }],
    })
    await expect(
      service.updateUser(TARGET_ID, { email: 'taken@example.com' }, ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(tx.save).not.toHaveBeenCalled()
    expect(auth.revokeAllSessions).not.toHaveBeenCalled()
    expect(backups.moveBackupPrefix).not.toHaveBeenCalled()
  })

  it('409s when another user holds the address in a different case', async () => {
    const { service, holderChain, tx, auth, backups } = makeService({
      user: makeUser(),
      // registration stores raw emails, so the row can be mixed-case while the
      // admin submits the lowercased form — an exact-match pre-check would miss it
      emailHolders: [{ id: OTHER_ID, email: 'Taken@Example.com' }],
    })

    await expect(
      service.updateUser(TARGET_ID, { email: 'taken@example.com' }, ADMIN_ID),
    ).rejects.toBeInstanceOf(ConflictException)

    expect(holderChain.where).toHaveBeenCalledWith('LOWER(u.email) = LOWER(:email)', {
      email: 'taken@example.com',
    })
    expect(holderChain.andWhere).toHaveBeenCalledWith('u.id != :id', { id: TARGET_ID })
    expect(tx.save).not.toHaveBeenCalled()
    expect(auth.revokeAllSessions).not.toHaveBeenCalled()
    expect(backups.moveBackupPrefix).not.toHaveBeenCalled()
  })

  it('excludes the target row from the holder lookup (own row is never a conflict)', async () => {
    const { service, holderChain, tx } = makeService({
      user: makeUser({ email: 'old-address@example.com' }),
      emailHolders: [{ id: TARGET_ID, email: 'Taken@Example.com' }],
    })

    const res = await service.updateUser(TARGET_ID, { email: 'taken@example.com' }, ADMIN_ID)

    expect(holderChain.andWhere).toHaveBeenCalledWith('u.id != :id', { id: TARGET_ID })
    expect(tx.save).toHaveBeenCalledWith(User, expect.objectContaining({ id: TARGET_ID }))
    expect(res.user.email).toBe('taken@example.com')
  })

  it('409s when the unique email index fires during save (race)', async () => {
    const { service, tx, auth, backups } = makeService({
      user: makeUser(),
      saveError: uniqueViolation(),
    })
    const err: unknown = await service
      .updateUser(TARGET_ID, { email: 'raced@example.com' }, ADMIN_ID)
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect(err).toBeInstanceOf(ConflictException)
    expect((err as ConflictException).message).toBe('Email already registered')
    expect(tx.save).toHaveBeenCalled()
    expect(auth.revokeAllSessions).not.toHaveBeenCalled()
    expect(backups.moveBackupPrefix).not.toHaveBeenCalled()
  })

  it('stores the password as an argon2id hash, never plaintext', async () => {
    const user = makeUser()
    const { service } = makeService({ user })
    await service.updateUser(TARGET_ID, { password: 'new-password-123' }, ADMIN_ID)
    expect(user.passwordHash).not.toBe('new-password-123')
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true)
    await expect(argon2.verify(user.passwordHash, 'new-password-123')).resolves.toBe(true)
  })

  it('normalizes the email, revokes sessions and returns the backup outcome', async () => {
    const user = makeUser()
    const { service, userRepo, tx, auth, backups } = makeService({ user })
    const res = await service.updateUser(TARGET_ID, { email: 'New@Example.COM' }, ADMIN_ID)
    expect(user.email).toBe('new@example.com')
    // save and revocation travel through the same transaction manager
    expect(userRepo.manager.transaction).toHaveBeenCalledTimes(1)
    expect(tx.save).toHaveBeenCalledWith(User, user)
    expect(auth.revokeAllSessions).toHaveBeenCalledWith(TARGET_ID, tx)
    expect(backups.moveBackupPrefix).toHaveBeenCalledWith(
      expect.objectContaining({ id: TARGET_ID, email: 'new@example.com' }),
    )
    expect(res.user).toEqual({
      id: TARGET_ID,
      displayName: TARGET_NAME,
      email: 'new@example.com',
      role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(res.backup).toEqual(DEFAULT_MOVE)
  })

  it('revokes sessions on a password change', async () => {
    const { service, tx, auth, backups } = makeService({ user: makeUser() })
    await service.updateUser(TARGET_ID, { password: 'another-password' }, ADMIN_ID)
    expect(tx.save).toHaveBeenCalled()
    expect(auth.revokeAllSessions).toHaveBeenCalledWith(TARGET_ID, tx)
    expect(backups.moveBackupPrefix).toHaveBeenCalled()
  })

  it('rejects and reports nothing when the in-transaction revocation fails', async () => {
    const user = makeUser()
    const { service, userRepo, tx, auth, backups } = makeService({
      user,
      revokeError: new Error('db blip'),
    })

    await expect(
      service.updateUser(TARGET_ID, { email: 'new@example.com' }, ADMIN_ID),
    ).rejects.toThrow('db blip')

    // save + revocation share one transaction, so the real DB rolls the save back:
    // the edit is unapplied and the admin's plain retry re-applies it (no 400 no-op)
    expect(userRepo.manager.transaction).toHaveBeenCalledTimes(1)
    expect(tx.save.mock.invocationCallOrder[0]!).toBeLessThan(
      auth.revokeAllSessions.mock.invocationCallOrder[0]!,
    )
    // the failure must never fall through to a success response with a backup result
    expect(backups.moveBackupPrefix).not.toHaveBeenCalled()
  })

  it('does not revoke sessions on a displayName-only change but still syncs the backup', async () => {
    const { service, auth, backups } = makeService({ user: makeUser() })
    const res = await service.updateUser(TARGET_ID, { displayName: '  Renamed  ' }, ADMIN_ID)
    expect(auth.revokeAllSessions).not.toHaveBeenCalled()
    expect(backups.moveBackupPrefix).toHaveBeenCalledWith(
      expect.objectContaining({ id: TARGET_ID }),
    )
    expect(res.user.displayName).toBe('Renamed')
    expect(res.backup.synced).toBe(true)
  })

  it('never fails the edit when the backup move throws', async () => {
    const user = makeUser()
    const { service, backups } = makeService({ user, moveError: new Error('S3 down') })
    const res = await service.updateUser(TARGET_ID, { displayName: 'Renamed' }, ADMIN_ID)
    expect(backups.moveBackupPrefix).toHaveBeenCalled()
    expect(res.user.displayName).toBe('Renamed')
    expect(res.backup.synced).toBe(false)
    expect(res.backup.moved).toBe(false)
    expect(res.backup.to).toBe(backupPrefix(TARGET_EMAIL, TARGET_ID))
    expect(res.backup.error).toBe('S3 down')
  })

  it('never fails the edit when the fallback prefix computation itself throws', async () => {
    // a blank email makes backupPrefix throw — the unguarded fallback used to turn
    // the completed edit into a 500; it must degrade to `to: ''` instead
    const { service, backups } = makeService({
      user: makeUser({ email: '   ' }),
      moveError: new Error('S3 down'),
    })
    const res = await service.updateUser(TARGET_ID, { displayName: 'Renamed' }, ADMIN_ID)
    expect(backups.moveBackupPrefix).toHaveBeenCalled()
    expect(res.user.displayName).toBe('Renamed')
    expect(res.backup).toEqual({ synced: false, moved: false, to: '', error: 'S3 down' })
  })
})

describe('AdminService.syncUserBackup', () => {
  it('404s on an unknown user', async () => {
    const { service } = makeService({ user: null })
    await expect(service.syncUserBackup(TARGET_ID)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns the move result for a live user', async () => {
    const { service, backups } = makeService({ user: makeUser() })
    const res = await service.syncUserBackup(TARGET_ID)
    expect(backups.moveBackupPrefix).toHaveBeenCalledWith(
      expect.objectContaining({ id: TARGET_ID }),
    )
    expect(res).toEqual(DEFAULT_MOVE)
  })

  it('reports the failure instead of throwing when the move rejects', async () => {
    const { service, backups } = makeService({ user: makeUser(), moveError: new Error('S3 down') })
    await expect(service.syncUserBackup(TARGET_ID)).resolves.toEqual({
      synced: false,
      moved: false,
      to: backupPrefix(TARGET_EMAIL, TARGET_ID),
      error: 'S3 down',
    })
    expect(backups.moveBackupPrefix).toHaveBeenCalled()
  })
})

// The privilege-escalation barrier is the DTO + the exact global pipe main.ts
// installs: `role` is undeclared, so whitelist/forbidNonWhitelisted rejects it
// before the service ever sees a patch. Run the real pipe, not the service.
describe('UpdateAdminUserDto (global ValidationPipe contract)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })

  it('rejects a role escalation attempt', async () => {
    await expect(
      pipe.transform({ role: 'admin' }, { type: 'body', metatype: UpdateAdminUserDto }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects unknown keys even alongside a valid field', async () => {
    await expect(
      pipe.transform(
        { email: 'x@example.com', bogus: 1 },
        { type: 'body', metatype: UpdateAdminUserDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('trims a padded email before @IsEmail sees it', async () => {
    await expect(
      pipe.transform(
        { email: '  MiXeD@Example.COM  ' },
        { type: 'body', metatype: UpdateAdminUserDto },
      ),
    ).resolves.toEqual({ email: 'MiXeD@Example.COM' })
  })

  it('still rejects an empty-string email', async () => {
    await expect(
      pipe.transform({ email: '' }, { type: 'body', metatype: UpdateAdminUserDto }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
