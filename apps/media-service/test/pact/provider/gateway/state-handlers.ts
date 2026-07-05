/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import type { MockRepos } from './mock-repos'

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const PERSON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
const FACE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'
const PERSON_ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77'
const ALBUM_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
const ALBUM_ASSET_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'
const SHARE_ID = 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a55'
const SHARE_TOKEN = 'sharetoken1234567890ab'

const baseAsset = {
  id: ASSET_ID,
  userId: USER_ID,
  fileId: FILE_ID,
  kind: 'photo' as const,
  uploadedAt: new Date('2024-01-01T00:00:00.000Z'),
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
  orientation: null,
  latitude: null,
  longitude: null,
  fps: null,
  codec: null,
  hasAudio: null,
  metadataStatus: 'pending' as const,
  metadataExtractedAt: null,
}

const basePerson = {
  id: PERSON_ID,
  userId: USER_ID,
  name: 'Alice',
  coverFaceId: FACE_ID,
  clusterLabel: 'cluster-1',
  faceCount: 2,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

export function buildStateHandlers(repos: MockRepos): Record<string, () => Promise<void>> {
  return {
    'a photo asset can be created': () => Promise.resolve(),

    'user has no assets': () => {
      repos.mockAssetRepo.createQueryBuilder.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      })
      return Promise.resolve()
    },

    'user has trashed assets': () => {
      repos.mockAssetRepo.find.mockResolvedValue([
        {
          ...baseAsset,
          isTrashed: true,
          trashedAt: new Date('2024-01-02T00:00:00.000Z'),
          transcodeFileId: null,
        },
      ])
      repos.mockAssetRepo.createQueryBuilder.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      })
      return Promise.resolve()
    },

    'asset exists with id a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22 owned by another user': () => {
      repos.mockAssetRepo.save({
        ...baseAsset,
        userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd39999',
      })
      return Promise.resolve()
    },

    'asset exists with id a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22': () => {
      repos.mockAssetRepo.save(baseAsset)
      repos.mockAssetRepo.resetFindOne()
      return Promise.resolve()
    },

    'trashed asset exists with id a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22': () => {
      const trashedAsset = {
        ...baseAsset,
        isTrashed: true,
        trashedAt: new Date('2024-01-02T00:00:00.000Z'),
        transcodeFileId: null,
      }
      repos.mockAssetRepo.findOne.mockImplementation((opts: any) => {
        if (opts?.where?.id === ASSET_ID && (!opts.where.userId || opts.where.userId === USER_ID)) {
          return Promise.resolve(trashedAsset)
        }
        return Promise.resolve(null)
      })
      return Promise.resolve()
    },

    'assets exist for bulk trash': () => {
      repos.mockAssetRepo.createQueryBuilder.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 1 }),
      })
      return Promise.resolve()
    },

    'a get asset request for a user that does not own it': () => {
      repos.mockAssetRepo.save(baseAsset)
      return Promise.resolve()
    },

    [`asset ${ASSET_ID} has 2 thumbnails`]: () => {
      repos.mockAssetRepo.save(baseAsset)
      repos.mockThumbnailRepo.find.mockResolvedValue([
        {
          assetId: ASSET_ID,
          size: 'sm',
          fileId: FILE_ID,
          width: 320,
          height: 240,
          bytes: 12345,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
        },
        {
          assetId: ASSET_ID,
          size: 'md',
          fileId: FILE_ID,
          width: 640,
          height: 480,
          bytes: 23456,
          createdAt: new Date('2024-01-01T00:00:01.000Z'),
        },
      ])
      return Promise.resolve()
    },

    [`asset ${ASSET_ID} has a thumbnail of size sm`]: () => {
      repos.mockAssetRepo.save(baseAsset)
      repos.mockThumbnailRepo.findOne.mockImplementation(
        (opts: { where?: { assetId?: string; size?: string } }) => {
          if (opts?.where?.assetId === ASSET_ID && opts?.where?.size === 'sm') {
            return Promise.resolve({
              assetId: ASSET_ID,
              size: 'sm',
              fileId: FILE_ID,
              width: 320,
              height: 240,
              bytes: 12345,
              createdAt: new Date('2024-01-01T00:00:00.000Z'),
            })
          }
          return Promise.resolve(null)
        },
      )
      return Promise.resolve()
    },

    [`faces can be registered for asset ${ASSET_ID}`]: () => {
      repos.mockFaceRepo.save.mockImplementation((entities: unknown[]) =>
        Promise.resolve(
          (entities as { assetId: string; userId: string }[]).map((e, i) => ({
            id: `face-${i}`,
            ...e,
          })),
        ),
      )
      return Promise.resolve()
    },

    'persons exist for user': () => {
      repos.mockPersonRepo.query.mockResolvedValue([
        {
          id: PERSON_ID,
          userId: USER_ID,
          name: 'Alice',
          coverFaceId: FACE_ID,
          clusterLabel: 'cluster-1',
          faceCount: 2,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          liveFaceCount: '2',
        },
      ])
      return Promise.resolve()
    },

    'person exists with id': () => {
      repos.mockPersonRepo.findOne.mockResolvedValue({ ...basePerson })
      return Promise.resolve()
    },

    'person updated': () => {
      repos.mockPersonRepo.findOne
        .mockResolvedValueOnce({ ...basePerson })
        .mockResolvedValueOnce({ ...basePerson, name: 'Bob' })
      repos.mockPersonRepo.update.mockResolvedValue({ affected: 1 })
      return Promise.resolve()
    },

    'person assets exist': () => {
      repos.mockPersonRepo.findOne.mockResolvedValue({ ...basePerson })
      repos.mockFaceRepo.createQueryBuilder.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        addGroupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        getRawMany: vi
          .fn()
          .mockResolvedValue([{ assetId: PERSON_ASSET_ID, faceId: FACE_ID, faceCount: '2' }]),
        getRawOne: vi.fn().mockResolvedValue({ count: '1' }),
      })
      repos.mockAssetRepo.createQueryBuilder.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawMany: vi
          .fn()
          .mockResolvedValue([
            { id: PERSON_ASSET_ID, uploadedAt: new Date('2024-01-01T00:00:00.000Z') },
          ]),
      })
      return Promise.resolve()
    },

    'faces reassigned': () => {
      repos.mockFaceRepo.find.mockResolvedValue([{ id: FACE_ID, userId: USER_ID, personId: null }])
      repos.mockFaceRepo.save.mockImplementation((entities: unknown[]) => Promise.resolve(entities))
      repos.mockFaceRepo.count.mockResolvedValue(1)
      repos.mockPersonRepo.update.mockResolvedValue({ affected: 1 })
      return Promise.resolve()
    },

    'cover face set': () => {
      repos.mockPersonRepo.findOne.mockResolvedValue({ ...basePerson })
      repos.mockFaceRepo.findOne.mockResolvedValue({
        id: FACE_ID,
        userId: USER_ID,
        personId: PERSON_ID,
      })
      return Promise.resolve()
    },

    'an album can be created': () => Promise.resolve(),

    'user has no albums': () => {
      repos.mockAlbumRepo.findAndCount.mockResolvedValue([[], 0])
      return Promise.resolve()
    },

    'album exists with id b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33': () => {
      repos.mockAlbumRepo.save({
        id: ALBUM_ID,
        userId: USER_ID,
        name: 'Summer 2024',
        description: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      })
      repos.mockAlbumAssetRepo.createQueryBuilder.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(0),
        insert: vi.fn().mockReturnThis(),
        into: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        orIgnore: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({}),
      })
      repos.mockAssetRepo.save({
        id: ALBUM_ASSET_ID,
        userId: USER_ID,
        kind: 'photo',
        fileId: FILE_ID,
        isTrashed: false,
      })
      return Promise.resolve()
    },

    'asset c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a44 is in album b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33':
      () => {
        repos.mockAlbumRepo.save({
          id: ALBUM_ID,
          userId: USER_ID,
          name: 'Summer 2024',
          description: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        })
        return Promise.resolve()
      },

    'a share can be created for asset a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22': () => {
      repos.mockAssetRepo.save(baseAsset)
      repos.mockShareRepo.findOne.mockResolvedValue(null)
      repos.mockShareRepo.save.mockImplementation((data: any) => {
        return Promise.resolve({
          ...data,
          id: SHARE_ID,
          token: SHARE_TOKEN,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          asset: { ...baseAsset },
        })
      })
      return Promise.resolve()
    },

    'user has no shares': () => {
      repos.mockShareRepo.find.mockResolvedValue([])
      return Promise.resolve()
    },

    'a share exists with id d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a55': () => {
      const shareData = {
        id: SHARE_ID,
        userId: USER_ID,
        assetId: ASSET_ID,
        token: SHARE_TOKEN,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        asset: { ...baseAsset, isTrashed: false },
      }
      repos.mockShareRepo.findOne.mockImplementation((opts: any) => {
        if (opts?.where?.id === SHARE_ID) return Promise.resolve(shareData)
        return Promise.resolve(null)
      })
      repos.mockShareRepo.delete.mockResolvedValue({ affected: 1 })
      return Promise.resolve()
    },

    'a share exists with token sharetoken1234567890ab': () => {
      repos.mockShareRepo.findOne.mockImplementation((opts: any) => {
        if (opts?.where?.token === SHARE_TOKEN) {
          return Promise.resolve({
            id: SHARE_ID,
            userId: USER_ID,
            assetId: ASSET_ID,
            token: SHARE_TOKEN,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            asset: { ...baseAsset },
          })
        }
        return Promise.resolve(null)
      })
      return Promise.resolve()
    },
  }
}
