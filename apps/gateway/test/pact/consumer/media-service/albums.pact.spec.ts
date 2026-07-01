/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { createPact } from '../setup'
import { setupMediaServicePactModule } from './testing-module'
import type { StubProxy } from '../stub'

const mediaService = createPact('media-service', 'albums')
let app: INestApplication
let stub: StubProxy

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ALBUM_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
const ASSET_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'

const albumMatcher = {
  id: MatchersV3.uuid(ALBUM_ID),
  userId: MatchersV3.uuid(USER_ID),
  name: MatchersV3.string('Summer 2024'),
  description: null,
  assetCount: 0,
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
  updatedAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
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

describe('Gateway → media-service albums pact', () => {
  it('POST /v1/albums — create an album', async () => {
    await mediaService
      .given('an album can be created')
      .uponReceiving('a create album request')
      .withRequest({
        method: 'POST',
        path: '/v1/albums',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Summer 2024', userId: USER_ID },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: { ...albumMatcher, name: 'Summer 2024' },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post('/api/v1/albums')
          .send({ name: 'Summer 2024' })
        expect(res.status).toBe(201)
        expect(res.body.id).toBeTruthy()
        expect(res.body.name).toBe('Summer 2024')
      })
  })

  it('GET /v1/albums — list albums (empty)', async () => {
    await mediaService
      .given('user has no albums')
      .uponReceiving('a list albums request')
      .withRequest({
        method: 'GET',
        path: '/v1/albums',
        query: { userId: USER_ID, limit: '20' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: [],
          total: 0,
        },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get('/api/v1/albums').query({ limit: 20 })
        expect(res.status).toBe(200)
        expect(res.body.items).toEqual([])
        expect(res.body.total).toBe(0)
      })
  })

  it('GET /v1/albums/:id — get one album', async () => {
    await mediaService
      .given('album exists with id ' + ALBUM_ID)
      .uponReceiving('a get album request')
      .withRequest({
        method: 'GET',
        path: `/v1/albums/${ALBUM_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: albumMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get(`/api/v1/albums/${ALBUM_ID}`)
        expect(res.status).toBe(200)
        expect(res.body.id).toBe(ALBUM_ID)
      })
  })

  it('PATCH /v1/albums/:id — update album name', async () => {
    await mediaService
      .given('album exists with id ' + ALBUM_ID)
      .uponReceiving('an update album request')
      .withRequest({
        method: 'PATCH',
        path: `/v1/albums/${ALBUM_ID}`,
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Winter 2024', userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { ...albumMatcher, name: 'Winter 2024' },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/albums/${ALBUM_ID}`)
          .send({ name: 'Winter 2024' })
        expect(res.status).toBe(200)
        expect(res.body.name).toBe('Winter 2024')
      })
  })

  it('DELETE /v1/albums/:id — delete an album', async () => {
    await mediaService
      .given('album exists with id ' + ALBUM_ID)
      .uponReceiving('a delete album request')
      .withRequest({
        method: 'DELETE',
        path: `/v1/albums/${ALBUM_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).delete(`/api/v1/albums/${ALBUM_ID}`)
        expect(res.status).toBe(204)
      })
  })

  it('POST /v1/albums/:id/assets — add assets to album', async () => {
    await mediaService
      .given('album exists with id ' + ALBUM_ID)
      .uponReceiving('an add assets to album request')
      .withRequest({
        method: 'POST',
        path: `/v1/albums/${ALBUM_ID}/assets`,
        headers: { 'Content-Type': 'application/json' },
        body: { assetIds: [ASSET_ID], userId: USER_ID },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: { added: 1 },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post(`/api/v1/albums/${ALBUM_ID}/assets`)
          .send({ assetIds: [ASSET_ID] })
        expect(res.status).toBe(201)
      })
  })

  it('DELETE /v1/albums/:id/assets/:assetId — remove asset from album', async () => {
    await mediaService
      .given('asset ' + ASSET_ID + ' is in album ' + ALBUM_ID)
      .uponReceiving('a remove asset from album request')
      .withRequest({
        method: 'DELETE',
        path: `/v1/albums/${ALBUM_ID}/assets/${ASSET_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).delete(
          `/api/v1/albums/${ALBUM_ID}/assets/${ASSET_ID}`,
        )
        expect(res.status).toBe(204)
      })
  })

  it('GET /v1/albums/:id/assets — list assets in album', async () => {
    await mediaService
      .given('album exists with id ' + ALBUM_ID)
      .uponReceiving('a list album assets request')
      .withRequest({
        method: 'GET',
        path: `/v1/albums/${ALBUM_ID}/assets`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: [],
          total: 0,
        },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get(`/api/v1/albums/${ALBUM_ID}/assets`)
        expect(res.status).toBe(200)
        expect(res.body.items).toEqual([])
        expect(res.body.total).toBe(0)
      })
  })
})
