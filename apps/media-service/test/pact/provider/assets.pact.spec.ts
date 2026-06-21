/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR, createAssetRepo } from './verifier'
import type { INestApplication } from '@nestjs/common'

let app: INestApplication
let url: string
let mockAssetRepo: ReturnType<typeof createAssetRepo>

const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
  mockAssetRepo = setup.repos.mockAssetRepo
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe('Pact verification — media-service', () => {
  it('validates expectations of Gateway', async () => {
    await new Verifier({
      provider: 'media-service',
      providerBaseUrl: url,
      pactUrls: [path.join(PACT_DIR, 'gateway-media-service.json')],
      logLevel: 'error',
      stateHandlers: {
        'user 1 can create assets': () => { return Promise.resolve() },
        'user 1 has assets': async () => {
          await mockAssetRepo.save({
            id: ASSET_ID,
            userId: USER_ID,
            kind: 'photo',
            fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          })
          const qb = mockAssetRepo.createQueryBuilder()
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
          const found = (await mockAssetRepo.findOne({ where: { id: ASSET_ID } })) as Record<
            string,
            unknown
          >
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          qb.getManyAndCount.mockResolvedValue([[found], 1])
        },
        'asset a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22 exists for user 1': async () => {
          await mockAssetRepo.save({
            id: ASSET_ID,
            userId: USER_ID,
            kind: 'photo',
            fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          })
        },
        'asset a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22 is trashed for user 1': async () => {
          await mockAssetRepo.save({
            id: ASSET_ID,
            userId: USER_ID,
            kind: 'photo',
            fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
            isTrashed: true,
            trashedAt: new Date('2024-06-01T00:00:00.000Z'),
          })
        },
      },
    }).verifyProvider()
  }, 30_000)
})
