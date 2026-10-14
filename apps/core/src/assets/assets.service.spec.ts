import { ConflictException, ServiceUnavailableException } from '@nestjs/common'
import { In, QueryFailedError } from 'typeorm'
import type { DataSource, Repository } from 'typeorm'
import { AssetsService } from './assets.service'
import { Face, Person } from '../database/entities'
import type { Asset } from '../database/entities'
import type { AssetThumbnail } from '../database/entities'
import type { FileRecord } from '../database/entities'
import type { FacesService } from '../faces/faces.service'
import type { BullMqService } from '../queue/bullmq.service'
import type { PlacesResolveService } from '../places/places-resolve.service'

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "assets"("userId", "fileId") VALUES ($1, $2)',
    ['u1', 'file-1'],
    Object.assign(new Error('duplicate key value violates unique constraint "UQ_fileId"'), {
      code: '23505',
    }),
  )
}

function savedAsset(): Asset {
  return {
    id: 'asset-1',
    userId: 'u1',
    kind: 'photo',
    fileId: 'file-1',
    uploadedAt: new Date('2024-01-01T00:00:00.000Z'),
  } as unknown as Asset
}

function makeService(
  save: (this: void) => Promise<Asset>,
  findOne: (this: void) => Promise<Asset | null>,
) {
  const saveMock = vi.fn(save)
  const findOneMock = vi.fn(findOne)
  const repo = { save: saveMock, findOne: findOneMock } as unknown as Repository<Asset>
  const service = new AssetsService(
    repo,
    {} as unknown as Repository<AssetThumbnail>,
    {} as unknown as Repository<FileRecord>,
    {} as unknown as DataSource,
    {} as unknown as FacesService,
    {} as unknown as BullMqService,
    {} as unknown as PlacesResolveService,
  )
  return { service, saveMock, findOneMock }
}

describe('AssetsService.create upload race', () => {
  it('maps a UNIQUE(fileId) race to 409 with the winning asset id', async () => {
    const err = uniqueViolation()
    const winner = { id: 'asset-winner', fileId: 'file-1' } as unknown as Asset
    const { service } = makeService(
      () => Promise.reject(err),
      () => Promise.resolve(winner),
    )
    const caught: unknown = await service.create('u1', { fileId: 'file-1', kind: 'photo' }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(caught).toBeInstanceOf(ConflictException)
    expect((caught as ConflictException).getResponse()).toEqual({
      existingAssetId: 'asset-winner',
      existingFileId: 'file-1',
    })
  })

  it('rethrows the 23505 when the winner is already gone', async () => {
    const err = uniqueViolation()
    const { service, findOneMock } = makeService(
      () => Promise.reject(err),
      () => Promise.resolve(null),
    )
    await expect(service.create('u1', { fileId: 'file-1', kind: 'photo' })).rejects.toBe(err)
    expect(findOneMock).toHaveBeenCalledWith({ where: { fileId: 'file-1' } })
  })

  it('rethrows non-unique errors untouched', async () => {
    const err = new Error('connection lost')
    const { service, findOneMock } = makeService(
      () => Promise.reject(err),
      () => Promise.resolve(null),
    )
    await expect(service.create('u1', { fileId: 'file-1', kind: 'photo' })).rejects.toBe(err)
    expect(findOneMock).not.toHaveBeenCalled()
  })

  it('creates normally when there is no race', async () => {
    const { service } = makeService(
      () => Promise.resolve(savedAsset()),
      () => Promise.resolve(null),
    )
    const res = await service.create('u1', { fileId: 'file-1', kind: 'photo' })
    expect(res.id).toBe('asset-1')
    expect(res.fileId).toBe('file-1')
  })
})

function makeReprocessService(opts: {
  asset?: Asset | null
  thumbsResult?: boolean
  videoResult?: boolean
}) {
  const asset = (opts.asset ?? {
    id: 'asset-1',
    userId: 'u1',
    kind: 'photo',
    fileId: 'file-1',
  }) as Asset
  const repo = { findOne: vi.fn(() => Promise.resolve(asset)) } as unknown as Repository<Asset>
  const enqueueThumbnails = vi.fn(() => Promise.resolve(opts.thumbsResult ?? true))
  const enqueueVideo = vi.fn(() => Promise.resolve(opts.videoResult ?? true))
  const bullMq = {
    enqueueThumbnails,
    enqueueVideo,
  } as unknown as BullMqService
  const service = new AssetsService(
    repo,
    {} as unknown as Repository<AssetThumbnail>,
    {} as unknown as Repository<FileRecord>,
    {} as unknown as DataSource,
    {} as unknown as FacesService,
    bullMq,
    {} as unknown as PlacesResolveService,
  )
  return { service, bullMq, enqueueThumbnails, enqueueVideo }
}

describe('AssetsService.reprocess await (C8)', () => {
  it('awaits thumbnail enqueues and returns 4 on success', async () => {
    const { service, enqueueThumbnails } = makeReprocessService({ thumbsResult: true })
    await expect(service.reprocessThumbnails('u1', 'asset-1')).resolves.toEqual({ enqueued: 4 })
    expect(enqueueThumbnails).toHaveBeenCalledOnce()
  })

  it('throws 503 when thumbnail enqueue fails instead of false success', async () => {
    const { service } = makeReprocessService({ thumbsResult: false })
    await expect(service.reprocessThumbnails('u1', 'asset-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('awaits video enqueue and throws 503 on false', async () => {
    const { service, enqueueVideo } = makeReprocessService({
      asset: { id: 'asset-1', userId: 'u1', kind: 'video', fileId: 'file-1' } as Asset,
      videoResult: false,
    })
    await expect(service.reprocessVideo('u1', 'asset-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(enqueueVideo).toHaveBeenCalledOnce()
  })
})

function makeHardDeleteService(opts: {
  assets?: Asset[]
  faces?: Face[]
  person?: Person | null
  liveCount?: string
}) {
  const assets = opts.assets ?? [
    { id: 'asset-1', userId: 'u1', fileId: 'file-1', transcodeFileId: null } as Asset,
  ]
  const faces = opts.faces ?? []
  const person = opts.person ?? null
  const ops: { op: string; target: string }[] = []
  const countQb = {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getRawOne: vi.fn(() => Promise.resolve({ count: opts.liveCount ?? '0' })),
  }
  const em = {
    find: vi.fn((entity: { name: string }) => {
      if (entity.name === 'Face') return Promise.resolve(faces)
      return Promise.resolve([])
    }),
    findOne: vi.fn(() => Promise.resolve(person)),
    delete: vi.fn((entity: { name: string }) => {
      ops.push({ op: 'delete', target: entity.name })
      return Promise.resolve({ affected: 1 })
    }),
    update: vi.fn(() => {
      ops.push({ op: 'update', target: 'Person' })
      return Promise.resolve({ affected: 1 })
    }),
    getRepository: vi.fn((entity: { name: string }) => {
      if (entity.name === 'Face') return { createQueryBuilder: vi.fn(() => countQb) }
      return { update: vi.fn(() => Promise.resolve({ affected: 1 })) }
    }),
  }
  const repo = { find: vi.fn(() => Promise.resolve(assets)) } as unknown as Repository<Asset>
  const thumbRepo = {
    find: vi.fn(() => Promise.resolve([])),
  } as unknown as Repository<AssetThumbnail>
  const dataSource = {
    transaction: vi.fn((fn: (m: unknown) => Promise<void>) => fn(em)),
  } as unknown as DataSource
  const service = new AssetsService(
    repo,
    thumbRepo,
    {} as unknown as Repository<FileRecord>,
    dataSource,
    {} as unknown as FacesService,
    {} as unknown as BullMqService,
    {} as unknown as PlacesResolveService,
  )
  return { service, em, ops }
}

describe('AssetsService.hardDelete cover mirror (C4)', () => {
  it('nulls covers pointing at deleted faces and refreshes counts', async () => {
    const face = { id: 'face-1', assetId: 'asset-1', userId: 'u1', personId: 'p1' } as Face
    const person = { id: 'p1', userId: 'u1', coverFaceId: 'face-1' } as Person
    const { service, em } = makeHardDeleteService({ faces: [face], person })
    await (service as unknown as { hardDelete: (ids: string[]) => Promise<unknown> }).hardDelete([
      'asset-1',
    ])
    expect(em.delete).toHaveBeenCalledWith(Face as never, { assetId: In(['asset-1']) })
    expect(em.update).toHaveBeenCalledWith(Person as never, { id: 'p1' }, { coverFaceId: null })
  })

  it('leaves covers pointing at surviving faces alone', async () => {
    const face = { id: 'face-gone', assetId: 'asset-1', userId: 'u1', personId: 'p1' } as Face
    const person = { id: 'p1', userId: 'u1', coverFaceId: 'face-kept' } as Person
    const { service, em } = makeHardDeleteService({ faces: [face], person })
    await (service as unknown as { hardDelete: (ids: string[]) => Promise<unknown> }).hardDelete([
      'asset-1',
    ])
    const coverNull = (em.update.mock.calls as unknown[][]).some(
      (c) => ((c[2] as { coverFaceId?: unknown } | undefined)?.coverFaceId ?? undefined) === null,
    )
    expect(coverNull).toBe(false)
  })
})
