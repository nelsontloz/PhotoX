/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { createPact } from '../setup'
import { setupMediaServicePactModule } from './testing-module'
import type { StubProxy } from '../stub'

const mediaService = createPact('media-service', 'faces')
let app: INestApplication
let stub: StubProxy

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'

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

describe('Gateway → media-service faces pact', () => {
  it('POST /v1/assets/:id/faces — register faces', async () => {
    await mediaService
      .given('faces can be registered for asset ' + ASSET_ID)
      .uponReceiving('a register faces request')
      .withRequest({
        method: 'POST',
        path: `/v1/assets/${ASSET_ID}/faces`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          userId: USER_ID,
          faces: MatchersV3.eachLike({
            box: MatchersV3.like({ x: 10, y: 20, w: 100, h: 100 }),
            confidence: 0.95,
            embedding: MatchersV3.like([0.1, 0.2, 0.3]),
          }),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: { count: 1 },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer())
          .post(`/api/v1/assets/${ASSET_ID}/faces`)
          .send({
            userId: USER_ID,
            faces: [
              {
                box: { x: 10, y: 20, w: 100, h: 100 },
                confidence: 0.95,
                embedding: [0.1, 0.2, 0.3],
              },
            ],
          })
        expect(res.status).toBe(201)
        expect(res.body.count).toBe(1)
      })
  })
})
