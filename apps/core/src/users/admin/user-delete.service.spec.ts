import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStorageService } from '@photox/shared-config'
import { S3BackupService } from '../../backup/s3-backup.service'
import { UserDeleteService } from './user-delete.service'

const USER_ID = '33333333-3333-4333-8333-333333333333'
const EMAIL = 'doomed@example.com'

interface DeleteCall {
  entity: { name: string }
  criteria: unknown
}

function makeService(opts?: {
  storageRoot?: string
  user?: { id: string; email: string } | null
  assetIds?: string[]
}) {
  const ops: DeleteCall[] = []
  const manager = {
    delete: vi.fn((entity: { name: string }, criteria: unknown) => {
      ops.push({ entity, criteria })
      return { affected: 1 }
    }),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    find: vi.fn().mockResolvedValue([]),
  }
  const repos = new Map<string, unknown>()
  const dataSource = {
    getRepository: vi.fn((cls: { name: string }) => {
      if (!repos.has(cls.name)) {
        const rows = cls.name === 'Asset' ? (opts?.assetIds ?? []).map((id) => ({ id })) : []
        repos.set(cls.name, { find: vi.fn().mockResolvedValue(rows) })
      }
      return repos.get(cls.name)
    }),
    transaction: vi.fn(async (fn: (m: unknown) => Promise<void>) => fn(manager)),
  }
  const storageRoot = opts?.storageRoot ?? mkdtempSync(join(tmpdir(), 'user-delete-unit-'))
  const storage = {
    delete: vi.fn(async (key: string) => {
      await new LocalStorageService().delete(key)
    }),
    pathFor: (key: string) => new LocalStorageService().pathFor(key),
  }
  // point STORAGE_DIR at the scratch root for pathFor containment
  process.env.STORAGE_DIR = storageRoot
  const users = {
    findOne: vi
      .fn()
      .mockResolvedValue(opts?.user === undefined ? { id: USER_ID, email: EMAIL } : opts.user),
  }
  const files = {
    find: vi
      .fn()
      .mockResolvedValue([
        { storageKey: `originals/${USER_ID}/a.bin` },
        { storageKey: `derivatives/thumbnails/${USER_ID}/b.webp` },
      ]),
  }
  const bullMq = { getQueue: vi.fn() }
  const service = new UserDeleteService(
    dataSource as never,
    bullMq as never,
    storage as never,
    users as never,
    files as never,
  )
  return { service, ops, manager, users, files, bullMq, storage, storageRoot }
}

describe('UserDeleteService.runUserDelete', () => {
  it('deletes in dependency order: sessions, shares, faces/persons, albums, assets, files, user', async () => {
    const { service, ops, manager } = makeService({ assetIds: ['asset-1'] })
    manager.find.mockResolvedValue([{ id: 'album-1' }])
    await service.runUserDelete(USER_ID, 'backups/old/')
    const names = ops.map((op) => op.entity.name)
    const order = [
      'RefreshToken',
      'Share',
      'Face',
      'Person',
      'AlbumAsset',
      'Album',
      'Asset',
      'FileRecord',
      'User',
    ]
    let cursor = -1
    for (const name of order) {
      const idx = names.indexOf(name, cursor + 1)
      expect(idx).toBeGreaterThan(cursor)
      cursor = idx
    }
    // sessions also bump the access-token floor before the row dies
    const updateCall = manager.update.mock.calls[0] as unknown as [
      { name: string },
      string,
      { tokensValidAfter: unknown },
    ]
    expect(updateCall[0].name).toBe('User')
    expect(updateCall[1]).toBe(USER_ID)
    expect(updateCall[2].tokensValidAfter).toBeInstanceOf(Date)
  })

  it('returns alreadyGone without touching the DB when the row is missing', async () => {
    const { service, manager } = makeService({ user: null })
    const res = await service.runUserDelete(USER_ID, 'backups/old/')
    expect(res.alreadyGone).toBe(true)
    expect(manager.delete).not.toHaveBeenCalled()
  })

  it('deletes collected bytes plus strays, never models/, never S3', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'user-delete-unit-'))
    const stray = join(storageRoot, 'derivatives', 'thumbnails', USER_ID, 'stray.webp')
    mkdirSync(join(storageRoot, 'derivatives', 'thumbnails', USER_ID), { recursive: true })
    writeFileSync(stray, Buffer.from('stray'))
    const model = join(storageRoot, 'models', 'keep.onnx')
    mkdirSync(join(storageRoot, 'models'), { recursive: true })
    writeFileSync(model, Buffer.from('model'))

    const s3methods = [
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
    const spies = s3methods.map((m) =>
      vi.spyOn(S3BackupService.prototype, m as never).mockResolvedValue([] as never),
    )
    try {
      const { service, storage } = makeService({ storageRoot })
      const res = await service.runUserDelete(USER_ID, 'backups/old/')

      expect(res.backupPrefix).toContain(USER_ID)
      const deletedKeys = storage.delete.mock.calls.map((c) => c[0])
      expect(deletedKeys).toContain(`originals/${USER_ID}/a.bin`)
      expect(deletedKeys).toContain(`derivatives/thumbnails/${USER_ID}/b.webp`)
      expect(deletedKeys).toContain(`derivatives/thumbnails/${USER_ID}/stray.webp`)
      expect(deletedKeys.some((k) => k === 'models/keep.onnx' || k.startsWith('models/'))).toBe(
        false,
      )
      expect(existsSync(stray)).toBe(false)
      expect(existsSync(model)).toBe(true)
      expect(res.deletedStrays).toBe(1)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe('UserDeleteService.drainUserJobs', () => {
  it('removes only jobs scoped to the user and tolerates queue failures', async () => {
    const { service, bullMq } = makeService()
    const victim = { data: { userId: USER_ID }, remove: vi.fn().mockResolvedValue(undefined) }
    const stranger = { data: { userId: 'other' }, remove: vi.fn() }
    const unscoped = { data: {}, remove: vi.fn() }
    const queues = new Map([
      ['process-thumbnail', { getJobs: vi.fn().mockResolvedValue([victim, stranger, unscoped]) }],
      ['process-video', { getJobs: vi.fn().mockRejectedValue(new Error('redis down')) }],
    ])
    bullMq.getQueue.mockImplementation((name: string) => {
      const q = queues.get(name)
      if (!q) return { getJobs: vi.fn().mockResolvedValue([]) }
      return q
    })
    const removed = await service.drainUserJobs(USER_ID)
    expect(removed).toBe(1)
    expect(victim.remove).toHaveBeenCalled()
    expect(stranger.remove).not.toHaveBeenCalled()
  })
})
