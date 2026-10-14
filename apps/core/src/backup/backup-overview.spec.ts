import { describe, expect, it, vi, type Mock } from 'vitest'
import { randomUUID } from 'crypto'
import { ServiceUnavailableException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { backupPrefix, manifestKey, resolveBackupPrefix } from '@photox/shared-config'
import { User } from '../users/entities/user.entity'
import { Asset } from '../database/entities/asset.entity'
import {
  UserBackupService,
  buildBackupOverviewRow,
  buildFallbackEmail,
  buildOrphanBackupOverviewRow,
  type BackupStatus,
} from './user-backup.service'

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
      deleted: false,
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
      deleted: false,
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
    expect(row.deleted).toBe(false)
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

describe('buildOrphanBackupOverviewRow', () => {
  it('emits deleted rows with zero live counts and manifest identity', () => {
    const status: BackupStatus = {
      exists: true,
      userId: '33333333-3333-4333-8333-333333333333',
      emailAtBackup: 'gone@example.com',
      role: 'admin',
      backedUpAt: '2026-10-04T00:00:00.000Z',
      files: 4,
      assets: 3,
    }
    const row = buildOrphanBackupOverviewRow(
      'gone@example.com',
      '33333333-3333-4333-8333-333333333333',
      status,
    )
    expect(row).toEqual({
      userId: '33333333-3333-4333-8333-333333333333',
      email: 'gone@example.com',
      role: 'admin',
      totalAssets: 0,
      backedUpAssets: 3,
      backedUpFiles: 4,
      backedUpAt: '2026-10-04T00:00:00.000Z',
      exists: true,
      notBackedUp: 0,
      deleted: true,
    })
  })

  it('falls back to prefix email and user role when the manifest omits them', () => {
    const status: BackupStatus = { exists: true, degraded: 'unreadable', userId: 'u-orph' }
    const row = buildOrphanBackupOverviewRow('prefix@example.com', 'u-orph', status)
    expect(row.email).toBe('prefix@example.com')
    expect(row.role).toBe('user')
    expect(row.degraded).toBe('unreadable')
    expect(row.deleted).toBe(true)
    expect(row.emailAtBackup).toBeUndefined()
  })

  it('sets emailAtBackup only when prefix and manifest emails differ', () => {
    const status: BackupStatus = {
      exists: true,
      userId: 'u-orph',
      emailAtBackup: 'new@example.com',
      files: 1,
      assets: 1,
    }
    const diff = buildOrphanBackupOverviewRow('old@example.com', 'u-orph', status)
    expect(diff.email).toBe('new@example.com')
    expect(diff.emailAtBackup).toBe('new@example.com')
    const same = buildOrphanBackupOverviewRow('new@example.com', 'u-orph', status)
    expect(same.emailAtBackup).toBeUndefined()
  })
})

describe('buildFallbackEmail', () => {
  it('prefixes restored-<ms>-local and lowercases the whole address', () => {
    expect(buildFallbackEmail('Ada@Example.COM', 1720000000000)).toBe(
      'restored-1720000000000-ada@example.com',
    )
  })

  it('appends -<attempt> to the local part to stay a valid email', () => {
    expect(buildFallbackEmail('ada@example.com', 1720000000000, 2)).toBe(
      'restored-1720000000000-ada-2@example.com',
    )
  })
})

function manifestJson(opts: {
  userId: string
  email: string
  role?: 'user' | 'admin'
  files?: number
  assets?: number
  backedUpAt?: string
}): Buffer {
  const { userId, email, role = 'user', files = 0, assets = 0 } = opts
  const backedUpAt = opts.backedUpAt ?? '2026-10-01T00:00:00.000Z'
  const fileEntries = Array.from({ length: files }, () => ({
    id: randomUUID(),
    userId,
    storageKey: 'originals/a.bin',
    originalName: 'a.bin',
    mimeType: 'image/jpeg',
    sizeBytes: 1,
    checksumSha256: 'abc',
    purpose: 'original' as const,
    assetId: null,
  }))
  const assetEntries = Array.from({ length: assets }, () => ({
    id: randomUUID(),
    userId,
    kind: 'photo' as const,
    fileId: randomUUID(),
    isTrashed: false,
    trashedAt: null,
    title: null,
    description: null,
    takenAt: null,
    favorite: false,
    mimeType: null,
    sizeBytes: null,
    originalName: null,
    width: null,
    height: null,
    durationSeconds: null,
    cameraMake: null,
    cameraModel: null,
    lensModel: null,
    orientation: null,
    iso: null,
    fNumber: null,
    exposureTime: null,
    focalLength: null,
    latitude: null,
    longitude: null,
    altitude: null,
    placeCity: null,
    placeAdmin1: null,
    placeCountryCode: null,
    placeTimezone: null,
    placeDistanceKm: null,
    fps: null,
    codec: null,
    hasAudio: null,
    metadata: null,
    metadataStatus: 'pending' as const,
    transcodeStatus: null,
    thumbnailStatus: null,
    faceStatus: null,
    embeddingStatus: null,
    faceCount: null,
  }))
  return Buffer.from(
    JSON.stringify({
      manifestVersion: 1,
      userId,
      emailAtBackup: email,
      backedUpAt,
      detector: 'human',
      user: {
        id: userId,
        email,
        role,
        passwordHash: 'x',
        displayName: 'Test',
        tokensValidAfter: null,
      },
      files: fileEntries,
      assets: assetEntries,
      albums: [],
      albumAssets: [],
      shares: [],
      persons: [],
    }),
  )
}

function notFoundError(key: string): Error {
  const err = new Error(`missing key ${key}`)
  err.name = 'NoSuchKey'
  return err
}

function makeOverviewService(
  users: User[],
  counts: { userId: string; count: string }[],
  s3Keys: string[] = [],
  objects: Map<string, Buffer> = new Map<string, Buffer>(),
) {
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
  const getBuffer = vi.fn((key: string) => {
    const found = objects.get(key)
    if (!found) throw notFoundError(key)
    return Promise.resolve(Buffer.from(found))
  })
  const headObject = vi.fn((key: string) => {
    if (!objects.has(key)) throw notFoundError(key)
    return Promise.resolve()
  })
  const s3 = {
    ensureBucket: vi.fn().mockResolvedValue(undefined),
    listKeys: vi.fn().mockResolvedValue(s3Keys),
    getBuffer,
    headObject,
  } as never
  // ponytail: overview aggregation needs no DB beyond the stubbed repos — the
  // S3 manifest bytes are faked in-memory, so this stays a pure unit spec (no
  // testcontainers); manifest parsing stays in test/integration/user-backup
  const nil = undefined as never
  const svc = new UserBackupService(
    s3,
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
  return { svc, usersRepo, createQueryBuilder, qb, s3 }
}

describe('backupOverview', () => {
  it('returns one clamped live row per user with deleted:false', async () => {
    const ada = user({ email: 'ada@example.com' })
    const bob = user({
      id: '22222222-2222-4222-8222-222222222222',
      email: 'bob@example.com',
      role: 'admin',
    })
    const objects = new Map([
      [
        manifestKey(ada.email, ada.id),
        manifestJson({
          userId: ada.id,
          email: ada.email,
          files: 7,
          assets: 5,
          backedUpAt: '2026-10-01T00:00:00.000Z',
        }),
      ],
    ])
    const { svc, s3 } = makeOverviewService(
      [ada, bob],
      [{ userId: ada.id, count: '10' }],
      [manifestKey(ada.email, ada.id)],
      objects,
    )
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
        deleted: false,
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
        deleted: false,
      },
    ])
    const s3Mock = s3 as unknown as {
      ensureBucket: Mock<() => Promise<void>>
      listKeys: Mock<(prefix: string) => Promise<string[]>>
    }
    expect(s3Mock.ensureBucket).toHaveBeenCalledTimes(1)
    expect(s3Mock.listKeys).toHaveBeenCalledTimes(1)
  })

  it('unions live users with orphan S3 prefixes sorted by email', async () => {
    const ada = user({ email: 'ada@example.com' })
    const base = resolveBackupPrefix()
    const orphanId = '33333333-3333-4333-8333-333333333333'
    const orphanEmail = 'gone@example.com'
    const orphanPrefix = backupPrefix(orphanEmail, orphanId)
    expect(orphanPrefix.startsWith(base)).toBe(true)
    const objects = new Map([
      [
        `${orphanPrefix}manifest.json`,
        manifestJson({
          userId: orphanId,
          email: orphanEmail,
          files: 2,
          assets: 2,
          backedUpAt: '2026-10-05T00:00:00.000Z',
        }),
      ],
    ])
    const { svc } = makeOverviewService(
      [ada],
      [],
      [`${orphanPrefix}manifest.json`, `${orphanPrefix}originals/file.bin`],
      objects,
    )
    const rows = await svc.backupOverview()
    expect(rows).toEqual([
      {
        userId: ada.id,
        email: 'ada@example.com',
        role: 'user',
        totalAssets: 0,
        backedUpAssets: 0,
        backedUpFiles: 0,
        backedUpAt: null,
        exists: false,
        notBackedUp: 0,
        deleted: false,
      },
      {
        userId: orphanId,
        email: orphanEmail,
        role: 'user',
        totalAssets: 0,
        backedUpAssets: 2,
        backedUpFiles: 2,
        backedUpAt: '2026-10-05T00:00:00.000Z',
        exists: true,
        notBackedUp: 0,
        deleted: true,
      },
    ])
  })

  it('passes through corrupt/unreadable orphan status and skips manifest-less prefixes', async () => {
    const base = resolveBackupPrefix()
    const corruptId = '44444444-4444-4444-8444-444444444444'
    const corruptPrefix = backupPrefix('corrupt@example.com', corruptId)
    const unreadId = '55555555-5555-4555-8555-555555555555'
    const unreadPrefix = backupPrefix('unread@example.com', unreadId)
    const unreadManifestKey = `${unreadPrefix}manifest.json`
    const barePrefix = backupPrefix('bare@example.com', '66666666-6666-4666-8666-666666666666')
    const bareId = '66666666-6666-4666-8666-666666666666'
    const objects = new Map([
      [`${corruptPrefix}manifest.json`, Buffer.from('not-json{{{')],
      [unreadManifestKey, Buffer.from('unreadable-bytes')],
    ])
    const { svc, s3 } = makeOverviewService(
      [],
      [],
      [`${corruptPrefix}manifest.json`, unreadManifestKey, `${barePrefix}originals/stray.bin`],
      objects,
    )
    const s3Mock = s3 as unknown as {
      getBuffer: Mock<(key: string) => Promise<Buffer>>
      headObject: Mock<(key: string) => Promise<void>>
    }
    // Unreadable: GET throws a non-NotFound error while HEAD succeeds (object
    // exists) — overview must report degraded:'unreadable', not exists:false.
    const origGet = s3Mock.getBuffer.getMockImplementation()!
    s3Mock.getBuffer.mockImplementation((key: string) => {
      if (key === unreadManifestKey) {
        const err = new Error('injected unreadable')
        err.name = 'InternalError'
        throw err
      }
      return origGet(key)
    })
    const rows = await svc.backupOverview()
    expect(rows.map((r) => r.userId).sort()).toEqual([corruptId, unreadId].sort())
    expect(rows.find((r) => r.userId === corruptId)?.degraded).toBe('corrupt')
    expect(rows.find((r) => r.userId === unreadId)?.degraded).toBe('unreadable')
    for (const row of rows) expect(row.deleted).toBe(true)
    expect(s3Mock.getBuffer.mock.calls.map(([k]) => k)).not.toContain(`${barePrefix}manifest.json`)
    expect(rows.some((r) => r.userId === bareId)).toBe(false)
    expect(base.length).toBeGreaterThan(0)
  })

  it('issues one LIST + one ensureBucket + one GET per manifest with multiple orphans', async () => {
    const ada = user({ email: 'ada@example.com' })
    const orphans = [1, 2, 3].map((n) => ({
      id: `3333333${n}-3333-4333-8333-33333333333${n}`,
      email: `gone${n}@example.com`,
    }))
    const objects = new Map<string, Buffer>([
      [
        manifestKey(ada.email, ada.id),
        manifestJson({ userId: ada.id, email: ada.email, files: 1, assets: 1 }),
      ],
    ])
    const keys = [manifestKey(ada.email, ada.id)]
    for (const o of orphans) {
      const prefix = backupPrefix(o.email, o.id)
      objects.set(
        `${prefix}manifest.json`,
        manifestJson({ userId: o.id, email: o.email, files: 2, assets: 2 }),
      )
      keys.push(`${prefix}manifest.json`, `${prefix}originals/file.bin`)
    }
    // Manifest-less prefix: listed but never fetched.
    const barePrefix = backupPrefix('bare@example.com', '66666666-6666-4666-8666-666666666666')
    keys.push(`${barePrefix}originals/stray.bin`)
    const { svc, s3 } = makeOverviewService([ada], [{ userId: ada.id, count: '4' }], keys, objects)
    const rows = await svc.backupOverview()
    expect(rows).toHaveLength(4)
    expect(rows.filter((r) => r.deleted)).toHaveLength(3)
    const s3Mock = s3 as unknown as {
      ensureBucket: Mock<() => Promise<void>>
      listKeys: Mock<(prefix: string) => Promise<string[]>>
      getBuffer: Mock<(key: string) => Promise<Buffer>>
      headObject: Mock<(key: string) => Promise<void>>
    }
    expect(s3Mock.ensureBucket).toHaveBeenCalledTimes(1)
    expect(s3Mock.listKeys).toHaveBeenCalledTimes(1)
    // One GET per manifest (1 live + 3 orphans); the bare prefix is filtered
    // from the key set before any fetch, and healthy manifests need no HEAD.
    expect(s3Mock.getBuffer).toHaveBeenCalledTimes(4)
    expect(s3Mock.headObject).not.toHaveBeenCalled()
  })

  it('returns [] when no users and no S3 prefixes exist', async () => {
    const { svc, createQueryBuilder, s3 } = makeOverviewService([], [], [])
    await expect(svc.backupOverview()).resolves.toEqual([])
    expect(createQueryBuilder).not.toHaveBeenCalled()
    const s3Mock = s3 as unknown as {
      getBuffer: Mock<(key: string) => Promise<Buffer>>
    }
    expect(s3Mock.getBuffer).not.toHaveBeenCalled()
  })

  it('throws 503 when the base S3 listing fails (no partial table)', async () => {
    const ada = user()
    const { svc } = makeOverviewService([ada], [], [])
    ;(
      svc as unknown as { s3: { listKeys: Mock<(prefix: string) => Promise<string[]>> } }
    ).s3.listKeys.mockRejectedValue(new Error('s3 down'))
    await expect(svc.backupOverview()).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
