/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { createPact } from '../setup'
import { setupMediaServicePactModule } from './testing-module'
import type { StubProxy } from '../stub'

const mediaService = createPact('media-service', 'assets')
let app: INestApplication
let stub: StubProxy

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const SIZE = 'sm'
const assetMatcher = {
  id: MatchersV3.uuid(ASSET_ID),
  userId: MatchersV3.uuid(USER_ID),
  kind: 'photo',
  fileId: MatchersV3.uuid(FILE_ID),
  uploadedAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
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
  metadataStatus: MatchersV3.regex(/pending|ready|failed/, 'pending'),
  metadataExtractedAt: null,
}

const thumbnailMatcher = {
  size: MatchersV3.string(SIZE),
  fileId: MatchersV3.uuid(FILE_ID),
  width: MatchersV3.integer(320),
  height: MatchersV3.integer(240),
  bytes: MatchersV3.integer(12345),
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
}

beforeAll(async () => {
  const setup = await setupMediaServicePactModule()
  app = setup.app
  stub = setup.stub
}, 30_000)

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  stub.targetUrl = ''
  stub.calls.length = 0
})

describe('Gateway → media-service assets pact', () => {
  it('POST /v1/assets — create a photo', async () => {
    await mediaService
      .given('a photo asset can be created')
      .uponReceiving('a create asset request')
      .withRequest({
        method: 'POST',
        path: '/v1/assets',
        headers: { 'Content-Type': 'application/json' },
        body: { fileId: FILE_ID, kind: 'photo', userId: USER_ID },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: assetMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post('/api/v1/assets')
          .send({ fileId: FILE_ID, kind: 'photo' })
        expect(res.status).toBe(201)
        expect(res.body.id).toBeTruthy()
        expect(res.body.kind).toBe('photo')
      })
  })

  it('GET /v1/assets — list assets (empty)', async () => {
    await mediaService
      .given('user has no assets')
      .uponReceiving('a list assets request')
      .withRequest({
        method: 'GET',
        path: '/v1/assets',
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get('/api/v1/assets')
        expect(res.status).toBe(200)
        expect(res.body.items).toEqual([])
        expect(res.body.total).toBe(0)
      })
  })

  it('GET /v1/assets/:id — get one asset', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a get asset request')
      .withRequest({
        method: 'GET',
        path: `/v1/assets/${ASSET_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: assetMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get(`/api/v1/assets/${ASSET_ID}`)
        expect(res.status).toBe(200)
        expect(res.body.id).toBe(ASSET_ID)
      })
  })

  it('PATCH /v1/assets/:id — update asset title', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('an update asset request')
      .withRequest({
        method: 'PATCH',
        path: `/v1/assets/${ASSET_ID}`,
        headers: { 'Content-Type': 'application/json' },
        body: { title: 'Updated Title', userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { ...assetMatcher, title: 'Updated Title' },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/assets/${ASSET_ID}`)
          .send({ title: 'Updated Title' })
        expect(res.status).toBe(200)
        expect(res.body.title).toBe('Updated Title')
      })
  })

  it('POST /v1/assets/:id/trash — trash an asset', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a trash asset request')
      .withRequest({
        method: 'POST',
        path: `/v1/assets/${ASSET_ID}/trash`,
        query: { userId: USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).post(`/api/v1/assets/${ASSET_ID}/trash`)
        expect(res.status).toBe(204)
      })
  })

  it('POST /v1/assets/:id/restore — restore an asset', async () => {
    await mediaService
      .given('trashed asset exists with id ' + ASSET_ID)
      .uponReceiving('a restore asset request')
      .withRequest({
        method: 'POST',
        path: `/v1/assets/${ASSET_ID}/restore`,
        query: { userId: USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).post(`/api/v1/assets/${ASSET_ID}/restore`)
        expect(res.status).toBe(204)
      })
  })

  it('GET /v1/assets/:id/thumbnails — list thumbnails', async () => {
    await mediaService
      .given(`asset ${ASSET_ID} has 2 thumbnails`)
      .uponReceiving('a list thumbnails request')
      .withRequest({
        method: 'GET',
        path: `/v1/assets/${ASSET_ID}/thumbnails`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.eachLike(thumbnailMatcher, 2),
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get(`/api/v1/assets/${ASSET_ID}/thumbnails`)
        expect(res.status).toBe(200)
        expect(res.body).toHaveLength(2)
      })
  })

  it('GET /v1/assets/:id/thumbnails/:size — get one thumbnail', async () => {
    await mediaService
      .given(`asset ${ASSET_ID} has a thumbnail of size ${SIZE}`)
      .uponReceiving('a get thumbnail request')
      .withRequest({
        method: 'GET',
        path: `/v1/assets/${ASSET_ID}/thumbnails/${SIZE}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: thumbnailMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get(
          `/api/v1/assets/${ASSET_ID}/thumbnails/${SIZE}`,
        )
        expect(res.status).toBe(200)
        expect(res.body.size).toBe(SIZE)
      })
  })
})
