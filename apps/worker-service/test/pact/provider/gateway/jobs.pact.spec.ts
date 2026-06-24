/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR } from './verifier'
import type { INestApplication } from '@nestjs/common'

let app: INestApplication
let url: string
let repos: Awaited<ReturnType<typeof setupMockedApp>>['repos']

const ASSET_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const JOB_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
  repos = setup.repos
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe('Pact verification — worker-service', () => {
  it('validates expectations of Gateway', async () => {
    await new Verifier({
      provider: 'worker-service',
      providerBaseUrl: url,
      pactUrls: [path.join(PACT_DIR, 'gateway-worker-service.json')],
      logLevel: 'error',
      stateHandlers: {
        'no existing job for this asset': () => {
          repos.mockJobRepo.findOne.mockResolvedValue(null)
          return Promise.resolve()
        },
        'job already queued for this asset and size': () => {
          repos.mockJobRepo.findOne.mockResolvedValue({
            id: JOB_ID,
            assetId: ASSET_ID,
            fileId: FILE_ID,
            size: 'sm',
            status: 'queued',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          })
          return Promise.resolve()
        },
      },
    }).verifyProvider()
  }, 30_000)
})
