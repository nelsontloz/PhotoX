import { describe, expect, it, vi } from 'vitest'
import type { Repository } from 'typeorm'
import { User } from '../users/entities/user.entity'
import { Asset } from '../database/entities/asset.entity'
import { UserBackupService, buildBackupOverviewRow, type BackupStatus } from './user-backup.service'

function user(over: Partial<User> = {}): User {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    role: 'user',
    passwordHash: 'x',
    displayName: 'Ada',
    tokensValidAfter: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }
}

describe('buildBackupOverviewRow', () => {
  it('joins live counts with manifest counts and computes the gap', () => {
    const status: BackupStatus = {
      exists: true,
      userId: 'u1',
      emailAtBackup: 'ada@example.com',
      backedUpAt: '2026-10-01T00:00:00.000Z',
      files: 7,
      assets: 5,
      albums: 1,
      shares: 0,
      persons: 0,
    }
    expect(buildBackupOverviewRow(user(), 10, status)).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'ada@example.com',
      role: 'user',
      totalAssets: 10,
      backedUpAssets: 5,
      backedUpFiles: 7,
      backedUpAt: '2026-10-01T00:00:00.000Z',
      exists: true,
      notBackedUp: 5,
    })
  })

  it('reports zeros + null backedUpAt when no backup exists', () => {
    expect(buildBackupOverviewRow(user(), 3, { exists: false })).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'ada@example.com',
      role: 'user',
      totalAssets: 3,
      backedUpAssets: 0,
      backedUpFiles: 0,
      backedUpAt: null,
      exists: false,
      notBackedUp: 3,
    })
  })

  it('clamps notBackedUp at zero when the manifest is newer than the live DB', () => {
    const status: BackupStatus = {
      exists: true,
      backedUpAt: '2026-10-02T00:00:00.000Z',
      files: 9,
      assets: 9,
    }
    const row = buildBackupOverviewRow(user(), 4, status)
    expect(row.backedUpAssets).toBe(9)
    expect(row.notBackedUp).toBe(0)
  })

  it('propagates the degraded flag for unreadable/corrupt manifests', () => {
    const unreadable: BackupStatus = { exists: true, degraded: 'unreadable', userId: 'u1' }
    expect(buildBackupOverviewRow(user(), 2, unreadable).degraded).toBe('unreadable')
    const corrupt: BackupStatus = {
      exists: true,
      degraded: 'corrupt',
      userId: 'u1',
      backedUpAt: '2026-10-03T00:00:00.000Z',
    }
    const row = buildBackupOverviewRow(user(), 2, corrupt)
    expect(row.degraded).toBe('corrupt')
    expect(row.backedUpAt).toBe('2026-10-03T00:00:00.000Z')
    expect(row.backedUpAssets).toBe(0)
    expect(row.notBackedUp).toBe(2)
  })
})

function makeOverviewService(users: User[], counts: { userId: string; count: string }[]) {
  const usersRepo = { find: vi.fn().mockResolvedValue(users) } as unknown as Repository<User>
  const qb = {
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue(counts),
  }
  const createQueryBuilder = vi.fn().mockReturnValue(qb)
  const assetsRepo = {
    createQueryBuilder,
  } as unknown as Repository<Asset>
  // ponytail: overview aggregation needs no S3/DB beyond the stubbed repos —
  // backupStatus is spied per test, so this stays a pure unit spec (no
  // testcontainers); manifest parsing stays in test/integration/user-backup
  const nil = undefined as never
  const svc = new UserBackupService(
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    usersRepo,
    nil,
    assetsRepo,
    nil,
    nil,
    nil,
    nil,
  )
  return { svc, usersRepo, createQueryBuilder, qb }
}

describe('backupOverview', () => {
  it('returns one clamped row per user in email order', async () => {
    const ada = user({ email: 'ada@example.com' })
    const bob = user({
      id: '22222222-2222-4222-8222-222222222222',
      email: 'bob@example.com',
      role: 'admin',
    })
    const { svc } = makeOverviewService([ada, bob], [{ userId: ada.id, count: '10' }])
    vi.spyOn(svc, 'backupStatus').mockImplementation((emailOrId: string) => {
      if (emailOrId === ada.id) {
        return Promise.resolve({
          exists: true,
          backedUpAt: '2026-10-01T00:00:00.000Z',
          files: 7,
          assets: 5,
        })
      }
      return Promise.resolve({ exists: false })
    })
    const rows = await svc.backupOverview()
    expect(rows).toEqual([
      {
        userId: ada.id,
        email: 'ada@example.com',
        role: 'user',
        totalAssets: 10,
        backedUpAssets: 5,
        backedUpFiles: 7,
        backedUpAt: '2026-10-01T00:00:00.000Z',
        exists: true,
        notBackedUp: 5,
      },
      {
        userId: bob.id,
        email: 'bob@example.com',
        role: 'admin',
        totalAssets: 0,
        backedUpAssets: 0,
        backedUpFiles: 0,
        backedUpAt: null,
        exists: false,
        notBackedUp: 0,
      },
    ])
  })

  it('returns [] without touching assets/S3 when there are no users', async () => {
    const { svc, createQueryBuilder } = makeOverviewService([], [])
    const spy = vi.spyOn(svc, 'backupStatus')
    await expect(svc.backupOverview()).resolves.toEqual([])
    expect(spy).not.toHaveBeenCalled()
    expect(createQueryBuilder).not.toHaveBeenCalled()
  })
})
