/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { Readable } from 'stream'
import { type INestApplication, ValidationPipe, Controller, Post, Body } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { FileRecord } from '../../../../src/entities/file-record.entity'
import { MinioService } from '../../../../src/storage/minio.service'
import { UserFilesModule } from '../../../../src/files/user/user-files.module'
import { createFileRepo } from './mock-repos'
import type { MockRepos } from './mock-repos'

const PACT_DIR = path.resolve(__dirname, '../../../../../../pacts')

@Controller('v1/internal/hls/files')
class MockHlsFilesController {
  @Post('batch')
  uploadBatch(@Body('userId') _userId: string, @Body('fileId') _fileId: string) {
    return { uploaded: 1 }
  }
}

export { PACT_DIR }

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
    imports: [UserFilesModule],
    controllers: [MockHlsFilesController],
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
    downloadFile: vi.fn().mockResolvedValue(Readable.from(Buffer.from('fake-image-bytes'))),
    downloadFileRange: vi.fn().mockResolvedValue(Readable.from(Buffer.from('fake-range-bytes'))),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(true),
    statFile: vi
      .fn()
      .mockResolvedValue({ size: 100, lastModified: new Date('2024-01-01T00:00:00.000Z') }),
    ping: vi.fn().mockResolvedValue(undefined),
  }
}
