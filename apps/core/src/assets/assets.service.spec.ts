import { ConflictException } from '@nestjs/common'
import { QueryFailedError } from 'typeorm'
import type { DataSource, Repository } from 'typeorm'
import { AssetsService } from './assets.service'
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
