import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, uploadForUser } from './helpers'
import type { FileListResponse } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/files', () => {
  it('UC-U3: lists my files paginated, ordered by createdAt DESC', async () => {
    const userId = mintUserId()
    await uploadForUser(httpServer, userId, 'a.png', Buffer.from('a'), 'image/png')
    await uploadForUser(httpServer, userId, 'b.png', Buffer.from('bb'), 'image/png')
    await uploadForUser(httpServer, userId, 'c.png', Buffer.from('ccc'), 'image/png')

    const res = await supertest(httpServer)
      .get('/v1/files')
      .set('x-user-id', userId)
      .expect(200)

    const body = res.body as FileListResponse
    expect(body.total).toBe(3)
    expect(body.limit).toBe(20)
    expect(body.offset).toBe(0)
    expect(body.items).toHaveLength(3)

    const ids = body.items.map((f) => f.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)

    const timestamps = body.items.map((f) => new Date(f.createdAt).getTime())
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]!).toBeGreaterThanOrEqual(timestamps[i]!)
    }
  })

  it('UC-U3: respects custom limit and offset', async () => {
    const userId = mintUserId()
    await uploadForUser(httpServer, userId, 'a.png', Buffer.from('a'), 'image/png')
    await uploadForUser(httpServer, userId, 'b.png', Buffer.from('bb'), 'image/png')
    await uploadForUser(httpServer, userId, 'c.png', Buffer.from('ccc'), 'image/png')

    const res = await supertest(httpServer)
      .get('/v1/files?limit=1&offset=1')
      .set('x-user-id', userId)
      .expect(200)

    const body = res.body as FileListResponse
    expect(body.total).toBe(3)
    expect(body.limit).toBe(1)
    expect(body.offset).toBe(1)
    expect(body.items).toHaveLength(1)
  })

  it('UC-U4: filters by mimeType prefix', async () => {
    const userId = mintUserId()
    await uploadForUser(httpServer, userId, 'img.png', Buffer.from('img'), 'image/png')
    await uploadForUser(httpServer, userId, 'vid.mp4', Buffer.from('vid'), 'video/mp4')

    const res = await supertest(httpServer)
      .get('/v1/files?mimeType=image/')
      .set('x-user-id', userId)
      .expect(200)

    const body = res.body as FileListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.mimeType).toBe('image/png')
  })

  it('does not include another user files', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    await uploadForUser(httpServer, userA, 'a.png', Buffer.from('a'), 'image/png')
    await uploadForUser(httpServer, userB, 'b.png', Buffer.from('bb'), 'image/png')

    const res = await supertest(httpServer)
      .get('/v1/files')
      .set('x-user-id', userA)
      .expect(200)

    const body = res.body as FileListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.userId).toBe(userA)
  })

  it('returns empty list for user with no files', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer)
      .get('/v1/files')
      .set('x-user-id', userId)
      .expect(200)

    const body = res.body as FileListResponse
    expect(body.total).toBe(0)
    expect(body.items).toHaveLength(0)
  })
})
