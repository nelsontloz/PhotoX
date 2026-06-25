/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Verifier } from '@pact-foundation/pact'
import { FileRecord } from '../../../../src/entities/file-record.entity'
import { MinioService } from '../../../../src/storage/minio.service'
import { UserFilesModule } from '../../../../src/files/user/user-files.module'
import { MockHlsFilesController, createMockHlsMinio } from '../shared/mock-hls'
import { createFileRepo } from './mock-repos'

const PACT_DIR = path.resolve(__dirname, '../../../../../../pacts')

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'

let app: INestApplication
let url: string
let mockFileRepo: ReturnType<typeof createFileRepo>
let mockMinio: ReturnType<typeof createMockHlsMinio>

function createMockMinio() {
  return createMockHlsMinio()
}

const baseFileRecord = {
  id: FILE_ID,
  userId: USER_ID,
  storageKey: `${USER_ID}/${FILE_ID}.png`,
  originalName: 'photo.jpg',
  mimeType: 'image/png',
  sizeBytes: 12345,
  checksumSha256: 'abc123def456',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  mockFileRepo = createFileRepo()
  mockMinio = createMockMinio()

  const module = await Test.createTestingModule({
    imports: [UserFilesModule],
    controllers: [MockHlsFilesController],
  })
    .overrideProvider(getRepositoryToken(FileRecord))
    .useValue(mockFileRepo)
    .overrideProvider(MinioService)
    .useValue(mockMinio)
    .compile()

  app = module.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  await app.listen(0)
  url = await app.getUrl()
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe('Pact verification — file-storage-service (worker HLS)', () => {
  it('validates expectations of Worker', async () => {
    await new Verifier({
      provider: 'file-storage-service',
      providerBaseUrl: url,
      pactUrls: [path.join(PACT_DIR, 'worker-service-file-storage-service.json')],
      logLevel: 'error',
      stateHandlers: {
        [`file exists with id ${FILE_ID}`]: () => {
          mockFileRepo.findOne.mockImplementation((opts: { where?: { id?: string } }) => {
            if (opts?.where?.id === FILE_ID) {
              return Promise.resolve(baseFileRecord)
            }
            return Promise.resolve(null)
          })
          return Promise.resolve()
        },
        'file does not exist': () => {
          mockFileRepo.findOne.mockResolvedValue(null)
          return Promise.resolve()
        },
        'user can upload a file': () => {
          mockFileRepo.create.mockImplementation((data: any) => ({
            ...baseFileRecord,
            ...data,
            id: data.id ?? FILE_ID,
            userId: data.userId ?? USER_ID,
          }))
          mockFileRepo.save.mockImplementation((data: any) => {
            const id = data.id ?? FILE_ID
            return Promise.resolve({
              ...baseFileRecord,
              ...data,
              id,
              userId: data.userId ?? USER_ID,
            })
          })
          mockMinio.uploadFile.mockResolvedValue(undefined)
          return Promise.resolve()
        },
        'file upload fails with server error': () => {
          mockMinio.uploadFile.mockRejectedValue(new Error('MinIO connection failed'))
          return Promise.resolve()
        },
        'user can upload HLS files': () => {
          mockMinio.uploadFile.mockResolvedValue(undefined)
          return Promise.resolve()
        },
      },
    }).verifyProvider()
  }, 30_000)
})
