/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Asset } from '../../../src/entities/asset.entity'
import { AssetThumbnail } from '../../../src/entities/asset-thumbnail.entity'
import { AssetsModule } from '../../../src/assets/assets.module'

export const PACT_DIR = path.resolve(__dirname, '../../../../../pacts')

const ASSET_DEFAULTS = {
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

export interface MockRepos {
  mockAssetRepo: ReturnType<typeof createAssetRepo>
}

export async function setupMockedApp(): Promise<{
  app: INestApplication
  url: string
  repos: MockRepos
}> {
  process.env.NODE_ENV = 'test'

  const mockAssetRepo = createAssetRepo()
  const mockThumbnailRepo = createBasicRepo()

  const module = await Test.createTestingModule({
    imports: [AssetsModule],
  })
    .overrideProvider(getRepositoryToken(Asset))
    .useValue(mockAssetRepo)
    .overrideProvider(getRepositoryToken(AssetThumbnail))
    .useValue(mockThumbnailRepo)
    .compile()

  const app = module.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  await app.listen(0)

  const url = await app.getUrl()

  return {
    app,
    url,
    repos: { mockAssetRepo },
  }
}

export function createAssetRepo() {
  const store: Record<string, any> = {}

  return {
    findOne: vi.fn().mockImplementation((opts: any) => {
      const id = opts?.where?.id
      if (!id) return Promise.resolve(null)
      const asset = store[id]
      if (!asset) return Promise.resolve(null)
      if (opts.where.userId && asset.userId !== opts.where.userId) return Promise.resolve(null)
      return Promise.resolve(asset)
    }),
    save: vi.fn().mockImplementation((data: any) => {
      const id = data.id ?? 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
      store[id] = {
        ...data,
        ...ASSET_DEFAULTS,
        id,
        uploadedAt: data.uploadedAt ?? new Date('2024-01-01T00:00:00.000Z'),
      }
      return Promise.resolve(store[id])
    }),
    update: vi.fn().mockImplementation((id: string, patch: any) => {
      if (store[id]) {
        store[id] = { ...store[id], ...patch }
      }
      return Promise.resolve({ affected: 1 })
    }),
    create: vi.fn((data: any) => data),
    find: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    }),
  }
}

function createBasicRepo() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation((data: any) => Promise.resolve(data)),
    create: vi.fn((data: any) => data),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    find: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    }),
  }
}
