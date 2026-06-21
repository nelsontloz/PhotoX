/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR } from './verifier'
import type { INestApplication } from '@nestjs/common'

let app: INestApplication
let url: string
let repos: Awaited<ReturnType<typeof setupMockedApp>>['repos']

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
  repos = setup.repos
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
        'user has no files': () => {
          repos.mockFileRepo.findOne.mockResolvedValue(null)
          const qb = repos.mockFileRepo.createQueryBuilder()
          qb.getManyAndCount.mockResolvedValue([[], 0])
          return Promise.resolve()
        },
        [`file exists with id ${FILE_ID}`]: () => {
          repos.mockFileRepo.findOne.mockImplementation((opts: { where?: { id?: string } }) => {
            if (opts?.where?.id === FILE_ID) {
              return Promise.resolve({
                id: FILE_ID,
                userId: USER_ID,
                storageKey: `${USER_ID}/${FILE_ID}.png`,
                originalName: 'photo.png',
                mimeType: 'image/png',
                sizeBytes: 12345,
                checksumSha256: 'abc123def456',
                createdAt: new Date('2024-01-01T00:00:00.000Z'),
              })
            }
            return Promise.resolve(null)
          })
          return Promise.resolve()
        },
        'file does not exist': () => {
          repos.mockFileRepo.findOne.mockResolvedValue(null)
          return Promise.resolve()
        },
      },
    }).verifyProvider()
  }, 30_000)
})
