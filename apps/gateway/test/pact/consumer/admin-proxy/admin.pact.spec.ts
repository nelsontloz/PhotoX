/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { createPact } from '../setup'
import { setupAdminProxyPactModule } from './testing-module'
import type { StubProxy } from '../stub'

const userService = createPact('user-service')
let app: INestApplication
let stub: StubProxy

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

const adminUserRow = {
  id: MatchersV3.uuid(USER_ID),
  displayName: MatchersV3.string('Ada Lovelace'),
  email: MatchersV3.string('ada@example.com'),
  role: MatchersV3.regex(/user|admin/, 'user'),
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
  assetCount: MatchersV3.integer(42),
  bytesUsed: MatchersV3.integer(1048576),
}

beforeAll(async () => {
  const setup = await setupAdminProxyPactModule()
  app = setup.app
  stub = setup.stub
}, 30_000)

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  stub.targetUrl = ''
  stub.calls.length = 0
  stub.interceptFn = undefined
})

describe('Gateway → user-service admin users pact', () => {
  it('GET /v1/admin/users — list users', async () => {
    await userService
      .given('admin lists all users')
      .uponReceiving('a list admin users request')
      .withRequest({
        method: 'GET',
        path: '/v1/admin/users',
        query: { limit: '20', offset: '0' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: MatchersV3.eachLike(adminUserRow, 1),
          total: MatchersV3.integer(2),
          limit: MatchersV3.integer(20),
          offset: MatchersV3.integer(0),
        },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        stub.interceptFn = (_serviceUrl, opts) => {
          if (opts.path.includes('stats')) {
            return { status: 200, data: {} }
          }
          return null
        }
        const res = await request(app.getHttpServer()).get('/api/v1/admin/users')
        expect(res.status).toBe(200)
        expect(res.body.items.length).toBeGreaterThan(0)
        expect(res.body.total).toBe(2)
      })
  })
})
