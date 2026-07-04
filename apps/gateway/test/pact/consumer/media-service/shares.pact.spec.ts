/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { createPact } from '../setup'
import { setupMediaServicePactModule } from './testing-module'
import type { StubProxy } from '../stub'

const mediaService = createPact('media-service', 'shares')
let app: INestApplication
let stub: StubProxy

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const SHARE_ID = 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a55'
const SHARE_TOKEN = 'sharetoken1234567890ab'

const shareMatcher = {
  id: MatchersV3.uuid(SHARE_ID),
  assetId: MatchersV3.uuid(ASSET_ID),
  userId: MatchersV3.uuid(USER_ID),
  token: MatchersV3.string(SHARE_TOKEN),
  assetFileId: MatchersV3.uuid(FILE_ID),
  assetThumbFileId: null,
  assetKind: 'photo',
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
}

const publicShareMatcher = {
  share: shareMatcher,
  asset: {
    id: MatchersV3.uuid(ASSET_ID),
    userId: MatchersV3.uuid(USER_ID),
    kind: 'photo',
    fileId: MatchersV3.uuid(FILE_ID),
    title: null,
    originalName: null,
    mimeType: null,
    width: null,
    height: null,
    durationSeconds: null,
    takenAt: null,
  },
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

describe('Gateway → media-service shares pact', () => {
  it('POST /v1/shares — create share', async () => {
    await mediaService
      .given('a share can be created for asset a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
      .uponReceiving('a create share request')
      .withRequest({
        method: 'POST',
        path: '/v1/shares',
        headers: { 'Content-Type': 'application/json' },
        body: { assetId: ASSET_ID, userId: USER_ID },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: shareMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post('/api/v1/shares')
          .send({ assetId: ASSET_ID })
        expect(res.status).toBe(201)
        expect(res.body.id).toBeTruthy()
        expect(res.body.token).toBeTruthy()
      })
  })

  it('GET /v1/shares — list shares (empty)', async () => {
    await mediaService
      .given('user has no shares')
      .uponReceiving('a list shares request')
      .withRequest({
        method: 'GET',
        path: '/v1/shares',
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { items: [] },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get('/api/v1/shares')
        expect(res.status).toBe(200)
        expect(res.body.items).toEqual([])
      })
  })

  it('DELETE /v1/shares/:id — revoke share', async () => {
    await mediaService
      .given('a share exists with id d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a55')
      .uponReceiving('a revoke share request')
      .withRequest({
        method: 'DELETE',
        path: `/v1/shares/${SHARE_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).delete(`/api/v1/shares/${SHARE_ID}`)
        expect(res.status).toBe(204)
      })
  })

  it('GET /v1/shares/public/:token — public view', async () => {
    await mediaService
      .given('a share exists with token sharetoken1234567890ab')
      .uponReceiving('a public share view request')
      .withRequest({
        method: 'GET',
        path: `/v1/shares/public/${SHARE_TOKEN}`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: publicShareMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get(`/api/share/${SHARE_TOKEN}`)
        expect(res.status).toBe(200)
        expect(res.body.share).toBeTruthy()
        expect(res.body.asset).toBeTruthy()
      })
  })
})
