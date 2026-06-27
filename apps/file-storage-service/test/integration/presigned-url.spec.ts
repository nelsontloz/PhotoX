import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, uploadForUser } from './helpers'

interface UrlResponse {
  url: string
  expiresAt: number
}

interface ErrorBody {
  message: string
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/files/:fileId/url', () => {
  it('UC-PRE-1: returns presigned URL + expiresAt within TTL window', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(httpServer, userId, 'a.png', Buffer.from('a'), 'image/png')
    const before = Date.now()

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/url`)
      .query({ userId, ttl: 60 })
      .expect(200)

    const body = res.body as UrlResponse
    expect(typeof body.url).toBe('string')
    expect(body.url).toContain(record.storageKey)
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + 60_000 - 1000)
    expect(body.expiresAt).toBeLessThanOrEqual(before + 60_000 + 1000)
  })

  it('UC-PRE-2: defaults TTL to 300s when query is omitted', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(httpServer, userId, 'b.png', Buffer.from('b'), 'image/png')
    const before = Date.now()

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/url`)
      .query({ userId })
      .expect(200)

    const expiresAt = (res.body as UrlResponse).expiresAt
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000 - 1000)
    expect(expiresAt).toBeLessThanOrEqual(before + 300_000 + 1000)
  })

  it('UC-PRE-3: ttl=1 accepted (lower boundary)', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(httpServer, userId, 'c.png', Buffer.from('c'), 'image/png')

    await supertest(httpServer)
      .get(`/v1/files/${record.id}/url`)
      .query({ userId, ttl: 1 })
      .expect(200)
  })

  it('UC-PRE-4: ttl=3600 accepted (upper boundary)', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(httpServer, userId, 'd.png', Buffer.from('d'), 'image/png')

    await supertest(httpServer)
      .get(`/v1/files/${record.id}/url`)
      .query({ userId, ttl: 3600 })
      .expect(200)
  })

  it('UC-PRE-5: ttl=0 returns 400', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(httpServer, userId, 'e.png', Buffer.from('e'), 'image/png')

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/url`)
      .query({ userId, ttl: 0 })
      .expect(400)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-PRE-5: ttl=3601 returns 400', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(httpServer, userId, 'f.png', Buffer.from('f'), 'image/png')

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/url`)
      .query({ userId, ttl: 3601 })
      .expect(400)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-PRE-5: ttl=abc (non-numeric) returns 400', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(httpServer, userId, 'g.png', Buffer.from('g'), 'image/png')

    await supertest(httpServer)
      .get(`/v1/files/${record.id}/url`)
      .query({ userId, ttl: 'abc' })
      .expect(400)
  })

  it('UC-PRE-6: 404 for unknown fileId', async () => {
    const res = await supertest(httpServer)
      .get('/v1/files/00000000-0000-0000-0000-000000000000/url')
      .query({ userId: mintUserId() })
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-PRE-7: any userId returns presigned URL (no ownership check on internal endpoint)', async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const record = await uploadForUser(httpServer, owner, 'h.png', Buffer.from('h'), 'image/png')

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/url`)
      .query({ userId: other, ttl: 60 })
      .expect(200)

    const body = res.body as UrlResponse
    expect(body.url).toContain(record.storageKey)
  })
})
