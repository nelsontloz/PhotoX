/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { createPact } from '../setup'
import { setupMediaServicePactModule } from './testing-module'
import type { StubProxy } from '../stub'

const mediaService = createPact('media-service', 'persons')
let app: INestApplication
let stub: StubProxy

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const PERSON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
const FACE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'
const TO_PERSON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66'
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77'

const personMatcher = {
  id: MatchersV3.uuid(PERSON_ID),
  userId: MatchersV3.uuid(USER_ID),
  name: MatchersV3.like('Alice'),
  coverFaceId: MatchersV3.uuid(FACE_ID),
  coverFaceUrl: MatchersV3.like('https://minio.example.com/face-thumb.jpg'),
  clusterLabel: MatchersV3.like('cluster-1'),
  faceCount: MatchersV3.integer(3),
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
  updatedAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
}

const personAssetMatcher = {
  assetId: MatchersV3.uuid(ASSET_ID),
  faceId: MatchersV3.uuid(FACE_ID),
  uploadedAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
  faceCount: MatchersV3.integer(1),
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

describe('Gateway → media-service persons pact', () => {
  it('GET /v1/persons — list persons', async () => {
    await mediaService
      .given('persons exist for user')
      .uponReceiving('a list persons request')
      .withRequest({
        method: 'GET',
        path: '/v1/persons',
        query: { userId: USER_ID, limit: '20', offset: '0' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: MatchersV3.eachLike(personMatcher),
          total: MatchersV3.integer(1),
          limit: 20,
          offset: 0,
        },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .get('/api/v1/persons')
          .query({ limit: '20', offset: '0' })
        expect(res.status).toBe(200)
        expect(res.body.items).toHaveLength(1)
        expect(res.body.total).toBe(1)
      })
  })

  it('GET /v1/persons/:id — get one person', async () => {
    await mediaService
      .given('person exists with id')
      .uponReceiving('a get person request')
      .withRequest({
        method: 'GET',
        path: `/v1/persons/${PERSON_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: personMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get(`/api/v1/persons/${PERSON_ID}`)
        expect(res.status).toBe(200)
        expect(res.body.id).toBe(PERSON_ID)
      })
  })

  it('PATCH /v1/persons/:id — rename a person', async () => {
    await mediaService
      .given('person updated')
      .uponReceiving('a rename person request')
      .withRequest({
        method: 'PATCH',
        path: `/v1/persons/${PERSON_ID}`,
        query: { userId: USER_ID },
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Bob' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { ...personMatcher, name: 'Bob' },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/persons/${PERSON_ID}`)
          .send({ name: 'Bob' })
        expect(res.status).toBe(200)
        expect(res.body.name).toBe('Bob')
      })
  })

  it('GET /v1/persons/:id/assets — list person assets', async () => {
    await mediaService
      .given('person assets exist')
      .uponReceiving('a list person assets request')
      .withRequest({
        method: 'GET',
        path: `/v1/persons/${PERSON_ID}/assets`,
        query: { userId: USER_ID, limit: '20', offset: '0' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          personId: MatchersV3.uuid(PERSON_ID),
          items: MatchersV3.eachLike(personAssetMatcher),
          total: MatchersV3.integer(1),
          limit: 20,
          offset: 0,
        },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .get(`/api/v1/persons/${PERSON_ID}/assets`)
          .query({ limit: '20', offset: '0' })
        expect(res.status).toBe(200)
        expect(res.body.personId).toBe(PERSON_ID)
        expect(res.body.items).toHaveLength(1)
      })
  })

  it('POST /v1/persons/:id/reassign — reassign faces', async () => {
    await mediaService
      .given('faces reassigned')
      .uponReceiving('a reassign faces request')
      .withRequest({
        method: 'POST',
        path: `/v1/persons/${PERSON_ID}/reassign`,
        query: { userId: USER_ID },
        headers: { 'Content-Type': 'application/json' },
        body: {
          toPersonId: TO_PERSON_ID,
          faceIds: MatchersV3.eachLike(MatchersV3.uuid(FACE_ID)),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { moved: MatchersV3.integer(2) },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post(`/api/v1/persons/${PERSON_ID}/reassign`)
          .send({
            toPersonId: TO_PERSON_ID,
            faceIds: [FACE_ID],
          })
        expect(res.status).toBe(200)
        expect(res.body.moved).toBe(2)
      })
  })

  it('PATCH /v1/persons/:id/cover — set cover face', async () => {
    await mediaService
      .given('cover face set')
      .uponReceiving('a set cover face request')
      .withRequest({
        method: 'PATCH',
        path: `/v1/persons/${PERSON_ID}/cover`,
        headers: { 'Content-Type': 'application/json' },
        body: { userId: USER_ID, faceId: FACE_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: true },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/persons/${PERSON_ID}/cover`)
          .send({ faceId: FACE_ID })
        expect(res.status).toBe(200)
        expect(res.body.ok).toBe(true)
      })
  })

  it('POST /v1/persons/cluster — trigger face clustering', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/persons/cluster')
    expect(res.status).toBe(202)
    expect(res.body.queued).toBe(true)
    expect(res.body.jobId).toBeTruthy()
  })
})
