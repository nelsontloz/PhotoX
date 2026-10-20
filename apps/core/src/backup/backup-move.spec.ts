import { describe, expect, it, vi, type Mock } from 'vitest'
import { randomUUID } from 'crypto'
import { backupPrefix } from '@photox/shared-config'
import { User } from '../users/entities/user.entity'
import { UserBackupService } from './user-backup.service'

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

interface ManifestInput {
  userId: string
  email: string
  role?: 'user' | 'admin'
  passwordHash?: string
  displayName?: string
  tokensValidAfter?: string | null
  backedUpAt?: string
}

function manifestJson(opts: ManifestInput): Buffer {
  const {
    userId,
    email,
    role = 'user',
    passwordHash = 'x',
    displayName = 'Test',
    tokensValidAfter = null,
    backedUpAt = '2026-10-01T00:00:00.000Z',
  } = opts
  return Buffer.from(
    JSON.stringify({
      manifestVersion: 1,
      userId,
      emailAtBackup: email,
      backedUpAt,
      user: { id: userId, email, role, passwordHash, displayName, tokensValidAfter },
      files: [
        {
          id: randomUUID(),
          userId,
          storageKey: 'originals/a.bin',
          originalName: 'a.bin',
          mimeType: 'image/jpeg',
          sizeBytes: 12,
          checksumSha256: 'abc',
          purpose: 'original',
          assetId: null,
        },
      ],
      assets: [],
      albums: [],
      albumAssets: [],
      shares: [],
      persons: [],
    }),
  )
}

interface MoveS3 {
  ensureBucket: Mock<() => Promise<void>>
  listKeys: Mock<(prefix: string) => Promise<string[]>>
  copyPrefix: Mock<(src: string, dst: string) => Promise<void>>
  getBuffer: Mock<(key: string) => Promise<Buffer>>
  putObject: Mock<(key: string, body: Buffer, contentType?: string) => Promise<void>>
  headObject: Mock<(key: string) => Promise<void>>
  deleteKeys: Mock<(keys: string[]) => Promise<void>>
}

/**
 * In-memory S3 fake: copyPrefix mirrors the real skip-manifest behavior, and
 * deleteKeys actually removes objects so "old prefix deleted only after verify"
 * is observable.
 */
function makeMoveService(objects: Map<string, Buffer> = new Map<string, Buffer>()) {
  const store = new Map(objects)
  const s3: MoveS3 = {
    ensureBucket: vi.fn(() => Promise.resolve()),
    listKeys: vi.fn((prefix: string) =>
      Promise.resolve([...store.keys()].filter((key) => key.startsWith(prefix))),
    ),
    copyPrefix: vi.fn((src: string, dst: string) => {
      for (const key of [...store.keys()].filter((k) => k.startsWith(src))) {
        if (key.endsWith('/manifest.json')) continue
        store.set(`${dst}${key.slice(src.length)}`, Buffer.from(store.get(key)!))
      }
      return Promise.resolve()
    }),
    getBuffer: vi.fn((key: string) => {
      const hit = store.get(key)
      if (!hit) {
        const err = new Error(`missing key ${key}`)
        err.name = 'NoSuchKey'
        throw err
      }
      return Promise.resolve(Buffer.from(hit))
    }),
    putObject: vi.fn((key: string, body: Buffer) => {
      store.set(key, Buffer.from(body))
      return Promise.resolve()
    }),
    headObject: vi.fn((key: string) => {
      if (!store.has(key)) {
        const err = new Error(`missing key ${key}`)
        err.name = 'NotFound'
        throw err
      }
      return Promise.resolve()
    }),
    deleteKeys: vi.fn((keys: string[]) => {
      for (const key of keys) store.delete(key)
      return Promise.resolve()
    }),
  }
  // ponytail: the move path touches S3 + the logger only — the DataSource/repos
  // are constructor-required but never reached, so stub them as undefined
  const nil = undefined as never
  const svc = new UserBackupService(
    s3 as never,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
  )
  return { svc, s3, store }
}

function parseManifest(raw: Buffer | undefined): Record<string, unknown> {
  expect(raw).toBeDefined()
  return JSON.parse(raw!.toString('utf-8')) as Record<string, unknown>
}

describe('moveBackupPrefix', () => {
  it('copies stale bytes, verifies the new manifest, then deletes the old prefix', async () => {
    const before = user({ email: 'old@example.com' })
    const after = user({ email: 'new@example.com' })
    const stale = backupPrefix(before.email, before.id)
    const to = backupPrefix(after.email, after.id)
    const { svc, s3, store } = makeMoveService(
      new Map([
        [`${stale}manifest.json`, manifestJson({ userId: after.id, email: before.email })],
        [`${stale}originals/a.bin`, Buffer.from('bytes')],
      ]),
    )

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({ synced: true, moved: true, from: stale, to })
    // bytes copied server-side, manifest NOT copied (rewritten fresh)
    expect(s3.copyPrefix).toHaveBeenCalledWith(stale, to)
    expect(store.get(`${to}originals/a.bin`)?.toString()).toBe('bytes')
    // old prefix gone, new manifest present
    expect([...store.keys()].filter((key) => key.startsWith(stale))).toEqual([])
    expect(store.has(`${to}manifest.json`)).toBe(true)
    // deletion strictly after the HEAD verify
    expect(s3.headObject.mock.invocationCallOrder[0]).toBeLessThan(
      s3.deleteKeys.mock.invocationCallOrder[0]!,
    )
    expect(s3.deleteKeys.mock.calls[0]![0].sort()).toEqual(
      [`${stale}manifest.json`, `${stale}originals/a.bin`].sort(),
    )
  })

  it('rewrites the manifest identity block while backedUpAt and the file list survive', async () => {
    const before = user({ email: 'old@example.com' })
    const after = user({
      email: 'new@example.com',
      role: 'admin',
      displayName: 'Ada New',
      passwordHash: 'hash-2',
      tokensValidAfter: new Date('2026-10-10T00:00:00.000Z'),
    })
    const stale = backupPrefix(before.email, before.id)
    const to = backupPrefix(after.email, after.id)
    const originalRaw = manifestJson({
      userId: after.id,
      email: before.email,
      backedUpAt: '2026-10-01T00:00:00.000Z',
    })
    const { svc, store } = makeMoveService(
      new Map([
        [`${stale}manifest.json`, originalRaw],
        [`${stale}originals/a.bin`, Buffer.from('bytes')],
      ]),
    )

    await svc.moveBackupPrefix(after)

    const original = parseManifest(originalRaw)
    const patched = parseManifest(store.get(`${to}manifest.json`))
    expect(patched.emailAtBackup).toBe('new@example.com')
    expect(patched.user).toMatchObject({
      id: after.id,
      email: 'new@example.com',
      role: 'admin',
      displayName: 'Ada New',
      passwordHash: 'hash-2',
      tokensValidAfter: '2026-10-10T00:00:00.000Z',
    })
    // bytes are still from the last backup
    expect(patched.backedUpAt).toBe(original.backedUpAt)
    expect(patched.files).toEqual(original.files)
    expect(patched.manifestVersion).toBe(1)
    expect(patched.userId).toBe(after.id)
  })

  it('keeps the old prefix when the manifest write fails', async () => {
    const after = user({ email: 'new@example.com' })
    const stale = backupPrefix('old@example.com', after.id)
    const to = backupPrefix(after.email, after.id)
    const staleManifest = `${stale}manifest.json`
    const { svc, s3, store } = makeMoveService(
      new Map([[staleManifest, manifestJson({ userId: after.id, email: 'old@example.com' })]]),
    )
    s3.putObject.mockRejectedValueOnce(new Error('s3 down'))

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({ synced: false, moved: false, to, error: 's3 down' })
    expect(s3.deleteKeys).not.toHaveBeenCalled()
    expect(store.has(staleManifest)).toBe(true)
    expect(store.has(`${to}manifest.json`)).toBe(false)
  })

  it('keeps the old prefix when the HEAD verify fails', async () => {
    const after = user({ email: 'new@example.com' })
    const stale = backupPrefix('old@example.com', after.id)
    const to = backupPrefix(after.email, after.id)
    const staleManifest = `${stale}manifest.json`
    const { svc, s3, store } = makeMoveService(
      new Map([[staleManifest, manifestJson({ userId: after.id, email: 'old@example.com' })]]),
    )
    s3.headObject.mockRejectedValueOnce(new Error('verify failed'))

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({ synced: false, moved: false, to, error: 'verify failed' })
    expect(s3.deleteKeys).not.toHaveBeenCalled()
    expect(store.has(staleManifest)).toBe(true)
  })

  it('returns reason:no-backup when no manifest exists anywhere', async () => {
    const after = user({ email: 'new@example.com' })
    const to = backupPrefix(after.email, after.id)
    const { svc, s3 } = makeMoveService()

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({ synced: false, moved: false, to, reason: 'no-backup' })
    expect(result.error).toBeUndefined()
    expect(s3.copyPrefix).not.toHaveBeenCalled()
    expect(s3.putObject).not.toHaveBeenCalled()
    expect(s3.deleteKeys).not.toHaveBeenCalled()
  })

  it('reports a sync failure when a stale prefix has no readable manifest', async () => {
    const after = user({ email: 'new@example.com' })
    const stale = backupPrefix('old@example.com', after.id)
    const to = backupPrefix(after.email, after.id)
    const staleBytes = `${stale}originals/a.bin`
    const { svc, s3, store } = makeMoveService(new Map([[staleBytes, Buffer.from('bytes')]]))

    const result = await svc.moveBackupPrefix(after)

    // bytes-only stale prefix is NOT the benign "never backed up" case
    expect(result).toEqual({ synced: false, moved: false, to, error: 'backup manifest unreadable' })
    expect(result.reason).toBeUndefined()
    expect(store.get(`${to}originals/a.bin`)?.toString()).toBe('bytes')
    expect(store.has(staleBytes)).toBe(true)
    expect(s3.putObject).not.toHaveBeenCalled()
    expect(s3.deleteKeys).not.toHaveBeenCalled()
  })

  it('reports a sync failure when the stale manifest is corrupt', async () => {
    const after = user({ email: 'new@example.com' })
    const stale = backupPrefix('old@example.com', after.id)
    const to = backupPrefix(after.email, after.id)
    const { svc, s3 } = makeMoveService(
      new Map([[`${stale}manifest.json`, Buffer.from('{ not json')]]),
    )

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({ synced: false, moved: false, to, error: 'backup manifest unreadable' })
    expect(s3.putObject).not.toHaveBeenCalled()
    expect(s3.deleteKeys).not.toHaveBeenCalled()
  })

  it('reports the scan failure instead of no-backup when the stale-prefix listing fails', async () => {
    const after = user({ email: 'new@example.com' })
    const to = backupPrefix(after.email, after.id)
    const { svc, s3 } = makeMoveService()
    s3.listKeys.mockRejectedValueOnce(new Error('listing down'))

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({
      synced: false,
      moved: false,
      to,
      error: 'stale prefix scan failed: listing down',
    })
    // an S3 outage must never be reported as the benign no-backup case
    expect(result.reason).toBeUndefined()
    expect(s3.copyPrefix).not.toHaveBeenCalled()
    expect(s3.putObject).not.toHaveBeenCalled()
  })

  it('returns an error result (never throws) when the target prefix cannot be computed', async () => {
    const { svc, s3 } = makeMoveService()

    await expect(svc.moveBackupPrefix(user({ email: '   ' }))).resolves.toEqual({
      synced: false,
      moved: false,
      to: '',
      error: 'Invalid backup email: must not be empty',
    })
    await expect(svc.moveBackupPrefix(user({ id: '' }))).resolves.toEqual({
      synced: false,
      moved: false,
      to: '',
      error: 'Invalid backup userId: must not be empty',
    })
    // returned before any S3 call — a throwing prefix computation is still a result
    expect(s3.ensureBucket).not.toHaveBeenCalled()
  })

  it('copies and deletes every stale prefix', async () => {
    const after = user({ email: 'new@example.com' })
    const staleA = backupPrefix('old-a@example.com', after.id)
    const staleB = backupPrefix('old-b@example.com', after.id)
    const to = backupPrefix(after.email, after.id)
    const { svc, s3, store } = makeMoveService(
      new Map([
        [`${staleA}manifest.json`, manifestJson({ userId: after.id, email: 'old-a@example.com' })],
        [`${staleA}originals/a.bin`, Buffer.from('a')],
        [`${staleB}manifest.json`, manifestJson({ userId: after.id, email: 'old-b@example.com' })],
        [`${staleB}originals/b.bin`, Buffer.from('b')],
      ]),
    )

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({ synced: true, moved: true, from: staleA, to })
    expect(s3.copyPrefix.mock.calls).toEqual([
      [staleA, to],
      [staleB, to],
    ])
    expect(store.get(`${to}originals/a.bin`)?.toString()).toBe('a')
    expect(store.get(`${to}originals/b.bin`)?.toString()).toBe('b')
    expect([...store.keys()].filter((key) => key.startsWith(staleA))).toEqual([])
    expect([...store.keys()].filter((key) => key.startsWith(staleB))).toEqual([])
  })

  it('reports synced:true, moved:false when the backup already lives at the new prefix', async () => {
    const after = user({ email: 'new@example.com' })
    const to = backupPrefix(after.email, after.id)
    const { svc, s3, store } = makeMoveService(
      new Map([[`${to}manifest.json`, manifestJson({ userId: after.id, email: after.email })]]),
    )

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({ synced: true, moved: false, to })
    expect(s3.putObject).toHaveBeenCalledWith(
      `${to}manifest.json`,
      expect.any(Buffer),
      'application/json',
    )
    expect(s3.deleteKeys).not.toHaveBeenCalled()
    expect(store.has(`${to}manifest.json`)).toBe(true)
  })

  it('returns synced:false and never throws when S3 fails', async () => {
    const after = user({ email: 'new@example.com' })
    const stale = backupPrefix('old@example.com', after.id)
    const to = backupPrefix(after.email, after.id)
    const seed = () =>
      new Map([
        [`${stale}manifest.json`, manifestJson({ userId: after.id, email: 'old@example.com' })],
        [`${stale}originals/a.bin`, Buffer.from('bytes')],
      ])

    const bucketDown = makeMoveService(seed())
    bucketDown.s3.ensureBucket.mockRejectedValueOnce(new Error('s3 down'))
    await expect(bucketDown.svc.moveBackupPrefix(after)).resolves.toEqual({
      synced: false,
      moved: false,
      to,
      error: 's3 down',
    })

    const copyDown = makeMoveService(seed())
    copyDown.s3.copyPrefix.mockRejectedValueOnce(new Error('copy failed'))
    await expect(copyDown.svc.moveBackupPrefix(after)).resolves.toEqual({
      synced: false,
      moved: false,
      to,
      error: 'copy failed',
    })
    expect(copyDown.s3.deleteKeys).not.toHaveBeenCalled()

    // non-Error throw still yields a string message
    const weird = makeMoveService(seed())
    weird.s3.copyPrefix.mockRejectedValueOnce('boom')
    await expect(weird.svc.moveBackupPrefix(after)).resolves.toEqual({
      synced: false,
      moved: false,
      to,
      error: 'boom',
    })
  })

  it('leaves a warn-only orphan when deleting a stale prefix fails', async () => {
    const after = user({ email: 'new@example.com' })
    const stale = backupPrefix('old@example.com', after.id)
    const to = backupPrefix(after.email, after.id)
    const staleManifest = `${stale}manifest.json`
    const { svc, s3, store } = makeMoveService(
      new Map([[staleManifest, manifestJson({ userId: after.id, email: 'old@example.com' })]]),
    )
    s3.deleteKeys.mockRejectedValueOnce(new Error('delete failed'))

    const result = await svc.moveBackupPrefix(after)

    expect(result).toEqual({ synced: true, moved: true, from: stale, to })
    expect(store.has(staleManifest)).toBe(true)
    expect(store.has(`${to}manifest.json`)).toBe(true)
  })
})
