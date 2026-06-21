/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { Readable } from 'stream'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { FileRecord } from '../../../src/entities/file-record.entity'
import { MinioService } from '../../../src/storage/minio.service'
import { UserFilesModule } from '../../../src/files/user/user-files.module'

export const PACT_DIR = path.resolve(__dirname, '../../../../../pacts')

export interface MockRepos {
  mockFileRepo: ReturnType<typeof createFileRepo>
}

export async function setupMockedApp(): Promise<{
  app: INestApplication
  url: string
  repos: MockRepos
}> {
  process.env.NODE_ENV = 'test'

  const mockFileRepo = createFileRepo()
  const mockMinioService = {
    uploadFile: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(Readable.from(Buffer.from('test'))),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(true),
    ping: vi.fn().mockResolvedValue(undefined),
  }

  const module = await Test.createTestingModule({
    imports: [UserFilesModule],
  })
    .overrideProvider(getRepositoryToken(FileRecord))
    .useValue(mockFileRepo)
    .overrideProvider(MinioService)
    .useValue(mockMinioService)
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
    repos: { mockFileRepo },
  }
}

export function createFileRepo() {
  const store: Record<string, any> = {}

  return {
    findOne: vi.fn().mockImplementation((opts: any) => {
      if (!opts?.where?.id) return Promise.resolve(null)
      return Promise.resolve(store[opts.where.id] ?? null)
    }),
    save: vi.fn().mockImplementation((data: any) => {
      const id = data.id ?? 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      store[id] = {
        ...data,
        id,
        createdAt: data.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
      }
      return Promise.resolve(store[id])
    }),
    create: vi.fn((data: any) => data),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    remove: vi.fn().mockImplementation((record: any) => {
      if (record.id) delete store[record.id]
      return Promise.resolve(record)
    }),
    find: vi.fn().mockResolvedValue([]),
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
