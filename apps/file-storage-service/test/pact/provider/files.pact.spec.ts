/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR, createFileRepo } from './verifier'
import type { INestApplication } from '@nestjs/common'

let app: INestApplication
let url: string
let mockFileRepo: ReturnType<typeof createFileRepo>

const BASE_FILE = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  storageKey: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg',
  originalName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024000,
  checksumSha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
}

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
  mockFileRepo = setup.repos.mockFileRepo
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe('Pact verification — file-storage-service', () => {
  it('validates expectations of Gateway', async () => {
    await new Verifier({
      provider: 'file-storage-service',
      providerBaseUrl: url,
      pactUrls: [path.join(PACT_DIR, 'gateway-file-storage-service.json')],
      logLevel: 'error',
      stateHandlers: {
        'user 1 has files': async () => {
          await mockFileRepo.save({ ...BASE_FILE })
          const qb = mockFileRepo.createQueryBuilder()
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
          const found = (await mockFileRepo.findOne({ where: { id: BASE_FILE.id } })) as Record<
            string,
            unknown
          >
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          qb.getManyAndCount.mockResolvedValue([[found], 1])
        },
        'file f47ac10b-58cc-4372-a567-0e02b2c3d479 exists for user 1': async () => {
          await mockFileRepo.save({ ...BASE_FILE })
        },
      },
    }).verifyProvider()
  }, 30_000)
})
