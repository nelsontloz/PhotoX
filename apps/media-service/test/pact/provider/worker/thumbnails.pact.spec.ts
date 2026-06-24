/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR } from './verifier'
import type { INestApplication } from '@nestjs/common'

let app: INestApplication
let url: string
let repos: Awaited<ReturnType<typeof setupMockedApp>>['repos']

const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'

const baseAsset = {
  id: ASSET_ID,
  userId: USER_ID,
  fileId: FILE_ID,
  kind: 'photo' as const,
  uploadedAt: new Date('2024-01-01T00:00:00.000Z'),
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

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
  repos = setup.repos
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe.skip('Pact verification — media-service (worker)', () => {
  it('validates expectations of Worker', async () => {
    await new Verifier({
      provider: 'media-service',
      providerBaseUrl: url,
      pactUrls: [path.join(PACT_DIR, 'worker-service-media-service.json')],
      logLevel: 'error',
      stateHandlers: {
        [`asset exists with id ${ASSET_ID}`]: () => {
          repos.mockAssetRepo.save(baseAsset)
          return Promise.resolve()
        },
        'asset does not exist': () => {
          repos.mockAssetRepo.findOne.mockResolvedValue(null)
          return Promise.resolve()
        },
      },
    }).verifyProvider()
  }, 30_000)
})
