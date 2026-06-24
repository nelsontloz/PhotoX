/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { Readable } from 'stream'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { FileRecord } from '../../../../src/entities/file-record.entity'
import { MinioService } from '../../../../src/storage/minio.service'
import { InternalFilesModule } from '../../../../src/files/internal/internal-files.module'
import { createFileRepo } from './mock-repos'
import type { MockRepos } from './mock-repos'

export const PACT_DIR = path.resolve(__dirname, '../../../../../../pacts')

export async function setupMockedApp(): Promise<{
  app: INestApplication
  url: string
  repos: MockRepos
  minio: ReturnType<typeof createMockMinio>
}> {
  process.env.NODE_ENV = 'test'

  const mockFileRepo = createFileRepo()
  const mockMinio = createMockMinio()

  const module = await Test.createTestingModule({
    imports: [InternalFilesModule],
  })
    .overrideProvider(getRepositoryToken(FileRecord))
    .useValue(mockFileRepo)
    .overrideProvider(MinioService)
    .useValue(mockMinio)
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
    minio: mockMinio,
  }
}

function createMockMinio() {
  return {
    uploadFile: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(Readable.from(Buffer.from('test'))),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(true),
    ping: vi.fn().mockResolvedValue(undefined),
  }
}
