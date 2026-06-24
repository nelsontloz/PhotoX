import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR } from './verifier'
import type { INestApplication } from '@nestjs/common'

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
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

let app: INestApplication
let url: string
let repos: Awaited<ReturnType<typeof setupMockedApp>>['repos']

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
  repos = setup.repos
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
        'a photo asset can be created': () => {
          return Promise.resolve()
        },
        'user has no assets': () => {
          return Promise.resolve()
        },
        'asset exists with id a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22': () => {
          repos.mockAssetRepo.save(baseAsset)
          return Promise.resolve()
        },
        'trashed asset exists with id a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22': () => {
          repos.mockAssetRepo.save({
            ...baseAsset,
            isTrashed: true,
            trashedAt: new Date('2024-01-02T00:00:00.000Z'),
          })
          return Promise.resolve()
        },
        [`asset ${ASSET_ID} has 2 thumbnails`]: () => {
          repos.mockAssetRepo.save(baseAsset)
          repos.mockThumbnailRepo.find.mockResolvedValue([
            {
              assetId: ASSET_ID,
              size: 'sm',
              fileId: FILE_ID,
              width: 320,
              height: 240,
              bytes: 12345,
              createdAt: new Date('2024-01-01T00:00:00.000Z'),
            },
            {
              assetId: ASSET_ID,
              size: 'md',
              fileId: FILE_ID,
              width: 640,
              height: 480,
              bytes: 23456,
              createdAt: new Date('2024-01-01T00:00:01.000Z'),
            },
          ])
          return Promise.resolve()
        },
        [`asset ${ASSET_ID} has a thumbnail of size sm`]: () => {
          repos.mockAssetRepo.save(baseAsset)
          repos.mockThumbnailRepo.findOne.mockImplementation(
            (opts: { where?: { assetId?: string; size?: string } }) => {
              if (opts?.where?.assetId === ASSET_ID && opts?.where?.size === 'sm') {
                return Promise.resolve({
                  assetId: ASSET_ID,
                  size: 'sm',
                  fileId: FILE_ID,
                  width: 320,
                  height: 240,
                  bytes: 12345,
                  createdAt: new Date('2024-01-01T00:00:00.000Z'),
                })
              }
              return Promise.resolve(null)
            },
          )
          return Promise.resolve()
        },
      },
    }).verifyProvider()
  }, 30_000)
})
