/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { createPact } from '../setup'
import { setupMediaServicePactModule } from './testing-module'
import type { StubProxy } from '../stub'

const mediaService = createPact('media-service', 'trash')
let app: INestApplication
let stub: StubProxy

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'

const trashItemMatcher = {
  fileIds: MatchersV3.eachLike(MatchersV3.uuid(FILE_ID)),
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

describe('Gateway → media-service trash pact', () => {
  it('GET /v1/assets/trashed — list trashed assets', async () => {
    await mediaService
      .given('user has trashed assets')
      .uponReceiving('a list trashed assets request')
      .withRequest({
        method: 'GET',
        path: '/v1/assets/trashed',
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
        const res = await request(app.getHttpServer()).get('/api/v1/assets/trashed')
        expect(res.status).toBe(200)
        expect(res.body.items).toEqual([])
        expect(res.body.total).toBe(0)
      })
  })

  it('DELETE /v1/assets/trashed — empty trash', async () => {
    await mediaService
      .given('user has trashed assets')
      .uponReceiving('an empty trash request')
      .withRequest({
        method: 'DELETE',
        path: '/v1/assets/trashed',
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: trashItemMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).delete('/api/v1/assets/trashed')
        expect(res.status).toBe(204)
      })
  })

  it('DELETE /v1/assets/trashed/:id — permanently delete one', async () => {
    await mediaService
      .given('trashed asset exists with id ' + ASSET_ID)
      .uponReceiving('a permanently delete trashed asset request')
      .withRequest({
        method: 'DELETE',
        path: `/v1/assets/trashed/${ASSET_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: trashItemMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).delete(`/api/v1/assets/trashed/${ASSET_ID}`)
        expect(res.status).toBe(204)
      })
  })

  it('POST /v1/assets/trashed/:id/restore — restore an asset', async () => {
    await mediaService
      .given('trashed asset exists with id ' + ASSET_ID)
      .uponReceiving('a restore asset request')
      .withRequest({
        method: 'POST',
        path: `/v1/assets/trashed/${ASSET_ID}/restore`,
        query: { userId: USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).post(
          `/api/v1/assets/trashed/${ASSET_ID}/restore`,
        )
        expect(res.status).toBe(204)
      })
  })
})
