import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { NotFoundException } from '@nestjs/common'
import { AlbumsService } from './albums.service'
import { Album } from '../entities/album.entity'
import { AlbumAsset } from '../entities/album-asset.entity'
import { Asset } from '../entities/asset.entity'
import { CreateAlbumDto } from './dto/create-album.dto'
import { UpdateAlbumDto } from './dto/update-album.dto'

function makeAlbum(overrides: Partial<Album> = {}): Album {
  const a = new Album()
  a.id = overrides.id ?? 'album-1'
  a.userId = overrides.userId ?? 'user-1'
  a.name = overrides.name ?? 'Test Album'
  a.description = overrides.description ?? null
  a.createdAt = overrides.createdAt! ?? new Date('2026-01-01')
  a.updatedAt = overrides.updatedAt! ?? new Date('2026-01-02')
  return a
}

function makeCountQb(count: number) {
  return {
    where: vi.fn().mockReturnThis(),
    getCount: vi.fn().mockResolvedValue(count),
  }
}

function makeRawCountQb(rows: { albumId: string; count: string }[]) {
  return {
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue(rows),
  }
}

function makeInsertQb() {
  return {
    insert: vi.fn().mockReturnThis(),
    into: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(),
    execute: vi.fn(),
  }
}

type MockFn = ReturnType<typeof vi.fn>

interface AlbumRepoMock {
  findAndCount: MockFn
  findOne: MockFn
  save: MockFn
  update: MockFn
  delete: MockFn
  createQueryBuilder: MockFn
}

interface AlbumAssetRepoMock {
  findAndCount: MockFn
  findOne: MockFn
  save: MockFn
  delete: MockFn
  getCount: MockFn
  createQueryBuilder: MockFn
}

interface AssetRepoMock {
  findOne: MockFn
  createQueryBuilder: MockFn
}

describe('AlbumsService', () => {
  let service: AlbumsService
  let albumRepo: AlbumRepoMock
  let albumAssetRepo: AlbumAssetRepoMock
  let assetRepo: AssetRepoMock

  beforeEach(async () => {
    albumRepo = {
      findAndCount: vi.fn(),
      findOne: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      createQueryBuilder: vi.fn(),
    }
    albumAssetRepo = {
      findAndCount: vi.fn(),
      findOne: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      getCount: vi.fn(),
      createQueryBuilder: vi.fn(),
    }
    assetRepo = {
      findOne: vi.fn(),
      createQueryBuilder: vi.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlbumsService,
        { provide: getRepositoryToken(Album), useValue: albumRepo },
        { provide: getRepositoryToken(AlbumAsset), useValue: albumAssetRepo },
        { provide: getRepositoryToken(Asset), useValue: assetRepo },
      ],
    }).compile()

    service = module.get(AlbumsService)
  })

  describe('create', () => {
    it('sets userId and returns DTO with assetCount 0', async () => {
      const album = makeAlbum()
      albumRepo.save.mockResolvedValue(album)

      const dto: CreateAlbumDto = { userId: 'user-1', name: 'Test Album' }
      const result = await service.create('user-1', dto)

      expect(albumRepo.save).toHaveBeenCalled()
      expect(result.id).toBe('album-1')
      expect(result.userId).toBe('user-1')
      expect(result.name).toBe('Test Album')
      expect(result.assetCount).toBe(0)
    })
  })

  describe('list', () => {
    it('calls findAndCount with userId filter and returns items + total', async () => {
      const album = makeAlbum()
      albumRepo.findAndCount.mockResolvedValue([[album], 1])
      albumRepo.createQueryBuilder.mockReturnValue(
        makeRawCountQb([{ albumId: 'album-1', count: '3' }]),
      )

      const result = await service.list('user-1', { userId: 'user-1' })

      expect(albumRepo.findAndCount).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
        take: 20,
        skip: 0,
      })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.assetCount).toBe(3)
      expect(result.total).toBe(1)
    })

    it('returns empty array without count query when no albums', async () => {
      albumRepo.findAndCount.mockResolvedValue([[], 0])

      const result = await service.list('user-1', { userId: 'user-1' })

      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('getOne', () => {
    it('throws NotFoundException when not found', async () => {
      albumRepo.findOne.mockResolvedValue(null)

      await expect(service.getOne('user-1', 'bad-id')).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when album belongs to another user', async () => {
      albumRepo.findOne.mockResolvedValue(null)

      await expect(service.getOne('other-user', 'album-1')).rejects.toThrow(NotFoundException)
    })

    it('returns DTO with assetCount when found', async () => {
      const album = makeAlbum()
      albumRepo.findOne.mockResolvedValue(album)
      albumAssetRepo.createQueryBuilder.mockReturnValue(makeCountQb(2))

      const result = await service.getOne('user-1', 'album-1')

      expect(result.assetCount).toBe(2)
      expect(result.id).toBe('album-1')
    })
  })

  describe('update', () => {
    it('throws on missing album', async () => {
      albumRepo.findOne.mockResolvedValue(null)

      const missingDto: UpdateAlbumDto = { userId: 'user-1', name: 'New' }
      await expect(service.update('user-1', 'bad-id', missingDto)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('calls update with partial fields and returns refreshed album', async () => {
      const album = makeAlbum()
      albumRepo.findOne.mockResolvedValueOnce(album)
      albumRepo.update.mockResolvedValue(undefined)
      albumRepo.findOne.mockResolvedValueOnce({ ...album, name: 'Updated' })
      albumAssetRepo.createQueryBuilder.mockReturnValue(makeCountQb(0))

      const dto: UpdateAlbumDto = { userId: 'user-1', name: 'Updated' }
      const result = await service.update('user-1', 'album-1', dto)

      expect(albumRepo.update).toHaveBeenCalledWith(
        'album-1',
        expect.objectContaining({ name: 'Updated' }),
      )
      expect(result.name).toBe('Updated')
    })
  })

  describe('delete', () => {
    it('throws on missing album', async () => {
      albumRepo.findOne.mockResolvedValue(null)

      await expect(service.delete('user-1', 'bad-id')).rejects.toThrow(NotFoundException)
    })

    it('calls delete with id and userId', async () => {
      albumRepo.findOne.mockResolvedValue(makeAlbum())
      albumRepo.delete.mockResolvedValue(undefined)

      await service.delete('user-1', 'album-1')

      expect(albumRepo.delete).toHaveBeenCalledWith({ id: 'album-1', userId: 'user-1' })
    })
  })

  describe('addAssets', () => {
    it('throws when album not found', async () => {
      albumRepo.findOne.mockResolvedValue(null)

      await expect(service.addAssets('user-1', 'bad-id', ['asset-1'])).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws when asset not found (no partial write)', async () => {
      albumRepo.findOne.mockResolvedValue(makeAlbum())
      assetRepo.findOne.mockResolvedValue(null)

      await expect(service.addAssets('user-1', 'album-1', ['missing'])).rejects.toThrow(
        NotFoundException,
      )
    })

    it('calls orIgnore insert with correct rows and returns refreshed album', async () => {
      const album = makeAlbum()
      const insertQb = makeInsertQb()
      const countQb = makeCountQb(1)

      albumRepo.findOne.mockResolvedValue(album)
      assetRepo.findOne.mockResolvedValue({ id: 'asset-1', userId: 'user-1', isTrashed: false })
      albumAssetRepo.createQueryBuilder.mockReturnValueOnce(insertQb).mockReturnValue(countQb)

      const result = await service.addAssets('user-1', 'album-1', ['asset-1'])

      expect(insertQb.execute).toHaveBeenCalled()
      expect(result.assetCount).toBe(1)
    })
  })

  describe('removeAsset', () => {
    it('throws when album not found', async () => {
      albumRepo.findOne.mockResolvedValue(null)

      await expect(service.removeAsset('user-1', 'bad-id', 'asset-1')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('calls delete with albumId and assetId', async () => {
      albumRepo.findOne.mockResolvedValue(makeAlbum())
      albumAssetRepo.delete.mockResolvedValue(undefined)

      await service.removeAsset('user-1', 'album-1', 'asset-1')

      expect(albumAssetRepo.delete).toHaveBeenCalledWith({
        albumId: 'album-1',
        assetId: 'asset-1',
      })
    })

    it('is idempotent when asset not in album', async () => {
      albumRepo.findOne.mockResolvedValue(makeAlbum())
      albumAssetRepo.delete.mockResolvedValue({ affected: 0 })

      await expect(service.removeAsset('user-1', 'album-1', 'nonexistent')).resolves.toBeUndefined()
    })
  })

  describe('listAssets', () => {
    it('throws when album not found', async () => {
      albumRepo.findOne.mockResolvedValue(null)

      await expect(service.listAssets('user-1', 'bad-id', {})).rejects.toThrow(NotFoundException)
    })

    it('returns paginated assets filtered by isTrashed=false', async () => {
      albumRepo.findOne.mockResolvedValue(makeAlbum())
      const mockAssets = [{ id: 'asset-1' }] as Asset[]
      const qb = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([mockAssets, 1]),
      }
      ;(assetRepo as { createQueryBuilder: MockFn }).createQueryBuilder = vi
        .fn()
        .mockReturnValue(qb)

      const result = await service.listAssets('user-1', 'album-1', { limit: 10, offset: 0 })

      expect(result.items).toEqual(mockAssets)
      expect(result.total).toBe(1)
    })
  })
})
