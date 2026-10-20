import { mkdtemp, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { ConflictException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import type { LocalStorageService } from '@photox/shared-config'
import type { Asset as AssetResponse } from '@photox/shared-types'
import { UserFilesService, type UploadedDiskFile } from './user-files.service'
import type { RegisterFileBodyDto } from './dto/register-file.body.dto'
import type { Asset } from '../../database/entities'
import type { FileRecord } from '../../database/entities'
import type { AssetsService } from '../../assets/assets.service'
import type { BullMqService } from '../../queue/bullmq.service'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

async function tmpUpload(name = 'pic.jpg'): Promise<UploadedDiskFile> {
  const dir = await mkdtemp(join(tmpdir(), 'photox-race-'))
  const path = join(dir, name)
  await writeFile(path, Buffer.concat([JPEG, randomBytes(64)]))
  const { size } = await stat(path)
  return { path, originalname: name, mimetype: 'image/jpeg', size }
}

function fileRow(partial: Partial<FileRecord> & { id: string }): FileRecord {
  return {
    userId: 'u1',
    storageKey: `originals/u1/${partial.id}.jpg`,
    originalName: 'pic.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    checksumSha256: 'c'.repeat(64),
    purpose: 'original',
    assetId: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...partial,
  }
}

function registerDto(partial: Partial<RegisterFileBodyDto> & { id: string }): RegisterFileBodyDto {
  return {
    kind: 'original',
    ext: 'jpg',
    checksumSha256: 'c'.repeat(64),
    originalName: 'pic.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 5,
    ...partial,
  }
}

// naturals: every findOne without an id in `where`, consumed in call order (fast path first,
// winner re-read later); byId: every findOne by id (the insert-arbitration read).
function makeUploadService(scenario: { naturals: (FileRecord | null)[]; byId: FileRecord | null }) {
  const queue = [...scenario.naturals]
  const fileFindOne = vi.fn((opts?: { where?: { id?: string } }): Promise<FileRecord | null> => {
    if (typeof opts?.where?.id === 'string') return Promise.resolve(scenario.byId)
    return Promise.resolve(queue.length > 0 ? (queue.shift() ?? null) : null)
  })
  const execute = vi.fn((): Promise<{ raw: unknown[] }> => Promise.resolve({ raw: [] }))
  const fileRepo = {
    findOne: fileFindOne,
    exists: vi.fn((): Promise<boolean> => Promise.resolve(false)),
    createQueryBuilder: vi.fn(() => ({
      insert: () => ({ values: () => ({ orIgnore: () => ({ execute }) }) }),
    })),
  } as unknown as Repository<FileRecord>

  const save = vi.fn<(key: string, tmp: string) => Promise<void>>()
  const remove = vi.fn<(key: string) => Promise<void>>()
  const storage = {
    save,
    delete: remove,
    exists: vi.fn((): Promise<boolean> => Promise.resolve(true)),
    buildKey: vi.fn(
      (kind: string, userId: string, fileId: string, ext: string): string =>
        `${kind}/${userId}/${fileId}.${ext}`,
    ),
  } as unknown as LocalStorageService

  const assetCreate =
    vi.fn<(userId: string, dto: { fileId: string; kind?: string }) => Promise<AssetResponse>>()
  assetCreate.mockResolvedValue({ id: 'asset-new' } as AssetResponse)
  const service = new UserFilesService(
    fileRepo,
    { findOne: vi.fn() } as unknown as Repository<Asset>,
    storage,
    { create: assetCreate } as unknown as AssetsService,
    {
      enqueueThumbnails: vi.fn((): Promise<boolean> => Promise.resolve(true)),
      enqueue: vi.fn((): Promise<boolean> => Promise.resolve(true)),
      enqueueAssetJob: vi.fn((): Promise<boolean> => Promise.resolve(true)),
    } as unknown as BullMqService,
  )
  return { service, execute, save, remove, assetCreate }
}

describe('UserFilesService upload race', () => {
  it('loser deletes its bytes and assets the winner file', async () => {
    const winner = fileRow({ id: 'winner-1' })
    const { service, execute, save, remove, assetCreate } = makeUploadService({
      naturals: [null, winner],
      byId: null,
    })
    const res = await service.upload('u1', await tmpUpload())
    expect(execute).toHaveBeenCalledOnce()
    expect(res.id).toBe('asset-new')
    expect(save).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith(save.mock.calls[0]?.[0])
    expect(assetCreate.mock.calls[0]?.[1]?.fileId).toBe('winner-1')
  })

  it('winner keeps its bytes and never deletes', async () => {
    const mine = fileRow({ id: 'mine-1' })
    const { service, remove, assetCreate } = makeUploadService({ naturals: [null], byId: mine })
    const res = await service.upload('u1', await tmpUpload())
    expect(res.id).toBe('asset-new')
    expect(remove).not.toHaveBeenCalled()
    expect(assetCreate.mock.calls[0]?.[1]?.fileId).toBe('mine-1')
  })
})

describe('UserFilesService upload kind override (C2-narrowed)', () => {
  it('ignores client kind=video for JPEG bytes and runs the photo pipeline', async () => {
    const mine = fileRow({ id: 'mine-1' })
    const { service, assetCreate } = makeUploadService({ naturals: [null], byId: mine })
    const res = await service.upload('u1', await tmpUpload(), { kind: 'video' })
    expect(res.id).toBe('asset-new')
    // derived solely from the sniffed mime, not the client override
    expect(assetCreate.mock.calls[0]?.[1]?.kind).toBe('photo')
  })

  it('ignores client kind=photo metadata but still derives photo for JPEG', async () => {
    const mine = fileRow({ id: 'mine-1' })
    const { service, assetCreate } = makeUploadService({ naturals: [null], byId: mine })
    await service.upload('u1', await tmpUpload(), { kind: 'photo' })
    expect(assetCreate.mock.calls[0]?.[1]?.kind).toBe('photo')
  })
})
describe('UserFilesService.register race', () => {
  it('winner registers with created:true', async () => {
    const row = fileRow({ id: 'reg-1' })
    const { service } = makeUploadService({ naturals: [null], byId: row })
    const { file, created } = await service.register('u1', registerDto({ id: 'reg-1' }))
    expect(created).toBe(true)
    expect(file.id).toBe('reg-1')
  })

  it('loser returns the winner with created:false', async () => {
    const winner = fileRow({ id: 'winner-1' })
    const { service } = makeUploadService({ naturals: [null, winner], byId: null })
    const { file, created } = await service.register('u1', registerDto({ id: 'reg-2' }))
    expect(created).toBe(false)
    expect(file.id).toBe('winner-1')
  })

  it('same id with different content still 409s', async () => {
    const foreign = fileRow({ id: 'reg-1', userId: 'other' })
    const { service } = makeUploadService({ naturals: [null], byId: foreign })
    await expect(service.register('u1', registerDto({ id: 'reg-1' }))).rejects.toThrow(
      ConflictException,
    )
  })
})

// file lookup batched by checksum, asset lookup batched by fileId — both scoped to the user
function makeExistsService(scenario: {
  files: Record<string, FileRecord | null>
  assets: Record<string, Asset | null>
}) {
  const allFiles = Object.values(scenario.files).filter((f): f is FileRecord => f !== null)
  const allAssets = Object.values(scenario.assets).filter((a): a is Asset => a !== null)
  // C6: batched to 2 queries — mocks return the full sets, the service filters via maps
  const fileFind = vi.fn((): Promise<FileRecord[]> => Promise.resolve(allFiles))
  const assetFind = vi.fn((): Promise<Asset[]> => Promise.resolve(allAssets))
  const service = new UserFilesService(
    { find: fileFind } as unknown as Repository<FileRecord>,
    { find: assetFind } as unknown as Repository<Asset>,
    {} as unknown as LocalStorageService,
    {} as unknown as AssetsService,
    {} as unknown as BullMqService,
  )
  return { service, fileFind, assetFind }
}

describe('UserFilesService.existsMany', () => {
  const HIT = 'a'.repeat(64)
  const ORPHAN = 'b'.repeat(64)
  const MISS = 'c'.repeat(64)

  function hitScenario() {
    return makeExistsService({
      files: {
        [HIT]: fileRow({ id: 'file-hit', checksumSha256: HIT }),
        [ORPHAN]: fileRow({ id: 'file-orphan', checksumSha256: ORPHAN }),
        [MISS]: null,
      },
      assets: {
        'file-hit': { id: 'asset-hit', fileId: 'file-hit' } as Asset,
        'file-orphan': null,
      },
    })
  }

  it('hit with asset returns both ids', async () => {
    const { service } = hitScenario()
    await expect(service.existsMany('u1', [{ checksumSha256: HIT }])).resolves.toEqual([
      {
        checksumSha256: HIT,
        exists: true,
        existingFileId: 'file-hit',
        existingAssetId: 'asset-hit',
      },
    ])
  })

  it('hit without asset returns only the file id', async () => {
    const { service } = hitScenario()
    await expect(service.existsMany('u1', [{ checksumSha256: ORPHAN }])).resolves.toEqual([
      { checksumSha256: ORPHAN, exists: true, existingFileId: 'file-orphan' },
    ])
  })

  it('miss returns exists:false with no ids', async () => {
    const { service } = hitScenario()
    await expect(service.existsMany('u1', [{ checksumSha256: MISS }])).resolves.toEqual([
      { checksumSha256: MISS, exists: false },
    ])
  })

  it('dedupes repeated checksums server-side', async () => {
    const { service, fileFind, assetFind } = hitScenario()
    const res = await service.existsMany('u1', [{ checksumSha256: HIT }, { checksumSha256: HIT }])
    expect(fileFind).toHaveBeenCalledOnce()
    expect(assetFind).toHaveBeenCalledOnce()
    expect(res).toEqual([
      {
        checksumSha256: HIT,
        exists: true,
        existingFileId: 'file-hit',
        existingAssetId: 'asset-hit',
      },
      {
        checksumSha256: HIT,
        exists: true,
        existingFileId: 'file-hit',
        existingAssetId: 'asset-hit',
      },
    ])
  })

  it('batches to 2 queries for many items', async () => {
    const { service, fileFind, assetFind } = hitScenario()
    await service.existsMany('u1', [
      { checksumSha256: HIT },
      { checksumSha256: ORPHAN },
      { checksumSha256: MISS },
      { checksumSha256: HIT },
    ])
    // C6: one file query + one asset query total, regardless of input length/duplicates
    expect(fileFind).toHaveBeenCalledOnce()
    expect(assetFind).toHaveBeenCalledOnce()
  })

  it('preserves input order across hits and misses', async () => {
    const { service } = hitScenario()
    await expect(
      service.existsMany('u1', [
        { checksumSha256: MISS },
        { checksumSha256: HIT },
        { checksumSha256: ORPHAN },
      ]),
    ).resolves.toEqual([
      { checksumSha256: MISS, exists: false },
      {
        checksumSha256: HIT,
        exists: true,
        existingFileId: 'file-hit',
        existingAssetId: 'asset-hit',
      },
      { checksumSha256: ORPHAN, exists: true, existingFileId: 'file-orphan' },
    ])
  })
})

// fileRepo stubs for UserFilesService.storageQuota: one raw SUM row (or no row at all)
function makeQuotaService(used: string | null) {
  const getRawOne = vi.fn(() => Promise.resolve(used === null ? undefined : { used }))
  const qb = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getRawOne,
  }
  const service = new UserFilesService(
    { createQueryBuilder: vi.fn(() => qb) } as unknown as Repository<FileRecord>,
    {} as unknown as Repository<Asset>,
    {} as unknown as LocalStorageService,
    {} as unknown as AssetsService,
    {} as unknown as BullMqService,
  )
  return { service, qb }
}

describe('UserFilesService.storageQuota', () => {
  async function withQuota(value: string | undefined, fn: () => Promise<void>): Promise<void> {
    const prev = process.env.STORAGE_QUOTA_BYTES
    if (value === undefined) delete process.env.STORAGE_QUOTA_BYTES
    else process.env.STORAGE_QUOTA_BYTES = value
    try {
      await fn()
    } finally {
      if (prev === undefined) delete process.env.STORAGE_QUOTA_BYTES
      else process.env.STORAGE_QUOTA_BYTES = prev
    }
  }

  it('reports used/limit/remaining from the original-purpose SUM', async () => {
    await withQuota('1000', async () => {
      const { service, qb } = makeQuotaService('400')
      await expect(service.storageQuota('u1')).resolves.toEqual({
        usedBytes: 400,
        limitBytes: 1000,
        remainingBytes: 600,
      })
      expect(qb.andWhere).toHaveBeenCalledWith('f.purpose = :purpose', { purpose: 'original' })
      expect(qb.where).toHaveBeenCalledWith('f.userId = :userId', { userId: 'u1' })
    })
  })

  it('clamps remaining at zero when usage is over the limit', async () => {
    await withQuota('1000', async () => {
      const { service } = makeQuotaService('1500')
      await expect(service.storageQuota('u1')).resolves.toEqual({
        usedBytes: 1500,
        limitBytes: 1000,
        remainingBytes: 0,
      })
    })
  })

  it('returns null limit/remaining when STORAGE_QUOTA_BYTES is unset', async () => {
    await withQuota(undefined, async () => {
      const { service } = makeQuotaService('400')
      await expect(service.storageQuota('u1')).resolves.toEqual({
        usedBytes: 400,
        limitBytes: null,
        remainingBytes: null,
      })
    })
  })

  it('treats a missing SUM row as zero used bytes', async () => {
    await withQuota('1000', async () => {
      const { service } = makeQuotaService(null)
      await expect(service.storageQuota('u1')).resolves.toEqual({
        usedBytes: 0,
        limitBytes: 1000,
        remainingBytes: 1000,
      })
    })
  })
})
