/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { Readable } from 'stream'
import {
  type INestApplication,
  ValidationPipe,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
} from '@nestjs/common'
import type { Response } from 'express'
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

  @Get(':userId/:fileId/*')
  stream(
    @Param('userId') _userId: string,
    @Param('fileId') _fileId: string,
    @Param('0') relPath: string,
    @Res() res: Response,
  ) {
    const ext = relPath.slice(relPath.lastIndexOf('.'))
    const mimeMap: Record<string, string> = {
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.m4s': 'video/iso.segment',
    }
    const contentType = mimeMap[ext] ?? 'application/octet-stream'

    const body =
      ext === '.m3u8'
        ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n0/seg_000.m4s\n'
        : 'fake segment bytes'

    res.set({
      'Content-Type': contentType,
      'Content-Length': String(Buffer.byteLength(body)),
    })
    res.send(body)
  }
}

export { PACT_DIR }

export async function setupMockedApp(): Promise<{
  app: INestApplication
  url: string
  repos: MockRepos
}> {
  process.env.NODE_ENV = 'test'

  const mockFileRepo = createFileRepo()
  const mockMinioService = {
    uploadFile: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi
      .fn()
      .mockResolvedValue(
        Readable.from(Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n0/seg_000.m4s\n')),
      ),
    downloadFileRange: vi.fn().mockResolvedValue(Readable.from(Buffer.from('fake-segment-bytes'))),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(true),
    statFile: vi
      .fn()
      .mockResolvedValue({ size: 100, lastModified: new Date('2024-01-01T00:00:00.000Z') }),
    ping: vi.fn().mockResolvedValue(undefined),
  }

  const module = await Test.createTestingModule({
    imports: [UserFilesModule],
    controllers: [MockHlsFilesController],
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
