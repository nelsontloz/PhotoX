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
import type { SettingsService } from '../../settings/settings.service'

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
function makeUploadService(scenario: {
  naturals: (FileRecord | null)[]
  byId: FileRecord | null
  existingAsset?: Asset | null
}) {
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

  const assetFindOne = vi.fn(
    (): Promise<Asset | null> => Promise.resolve(scenario.existingAsset ?? null),
  )
  const assetCreate = vi.fn<(userId: string, dto: { fileId: string }) => Promise<AssetResponse>>()
  assetCreate.mockResolvedValue({ id: 'asset-new' } as AssetResponse)
  const service = new UserFilesService(
    fileRepo,
    { findOne: assetFindOne } as unknown as Repository<Asset>,
    storage,
    { create: assetCreate } as unknown as AssetsService,
    {
      enqueueThumbnails: vi.fn((): Promise<boolean> => Promise.resolve(true)),
      enqueue: vi.fn((): Promise<boolean> => Promise.resolve(true)),
      enqueueAssetJob: vi.fn((): Promise<boolean> => Promise.resolve(true)),
    } as unknown as BullMqService,
    {
      getFaceDetector: vi.fn((): Promise<string> => Promise.resolve('human')),
    } as unknown as SettingsService,
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

// file lookup keyed by checksum, asset lookup keyed by fileId — both scoped to the user
function makeExistsService(scenario: {
  files: Record<string, FileRecord | null>
  assets: Record<string, Asset | null>
}) {
  const fileFindOne = vi.fn(
    (opts?: { where?: { checksumSha256?: string } }): Promise<FileRecord | null> =>
      Promise.resolve(scenario.files[opts?.where?.checksumSha256 ?? ''] ?? null),
  )
  const assetFindOne = vi.fn(
    (opts?: { where?: { fileId?: string } }): Promise<Asset | null> =>
      Promise.resolve(scenario.assets[opts?.where?.fileId ?? ''] ?? null),
  )
  const service = new UserFilesService(
    { findOne: fileFindOne } as unknown as Repository<FileRecord>,
    { findOne: assetFindOne } as unknown as Repository<Asset>,
    {} as unknown as LocalStorageService,
    {} as unknown as AssetsService,
    {} as unknown as BullMqService,
    {} as unknown as SettingsService,
  )
  return { service, fileFindOne, assetFindOne }
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
        'file-hit': { id: 'asset-hit' } as Asset,
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
    const { service, fileFindOne, assetFindOne } = hitScenario()
    const res = await service.existsMany('u1', [
      { checksumSha256: HIT },
      { checksumSha256: HIT, sizeBytes: 5 },
    ])
    expect(fileFindOne).toHaveBeenCalledOnce()
    expect(assetFindOne).toHaveBeenCalledOnce()
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
