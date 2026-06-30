import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId } from './helpers'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/admin/users/storage-stats', () => {
  it('ADM-01: returns summed sizeBytes per user', async () => {
    const userId1 = mintUserId()
    const userId2 = mintUserId()
    const content1 = Buffer.from('a'.repeat(1000))
    const content2 = Buffer.from('b'.repeat(2500))
    const content3 = Buffer.from('c'.repeat(500))

    await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId1)
      .attach('file', content1, { filename: 'a.png', contentType: 'image/png' })
      .expect(201)

    await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId1)
      .attach('file', content2, { filename: 'b.png', contentType: 'image/png' })
      .expect(201)

    await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId2)
      .attach('file', content3, { filename: 'c.png', contentType: 'image/png' })
      .expect(201)

    const res = await supertest(httpServer)
      .get(`/v1/admin/users/storage-stats?userIds=${userId1},${userId2}`)
      .expect(200)

    const body = res.body as Record<string, number>
    expect(body[userId1]).toBe(1000 + 2500)
    expect(body[userId2]).toBe(500)
  })

  it('ADM-02: returns empty object when no userIds provided', async () => {
    const res = await supertest(httpServer).get('/v1/admin/users/storage-stats').expect(200)

    const body = res.body as Record<string, number>
    expect(body).toEqual({})
  })

  it('ADM-03: user with no files is absent from result', async () => {
    const userId = mintUserId()
    const withFiles = mintUserId()
    const content = Buffer.from('x'.repeat(300))

    await supertest(httpServer)
      .post('/v1/files')
      .field('userId', withFiles)
      .attach('file', content, { filename: 'x.png', contentType: 'image/png' })
      .expect(201)

    const res = await supertest(httpServer)
      .get(`/v1/admin/users/storage-stats?userIds=${userId},${withFiles}`)
      .expect(200)

    const body = res.body as Record<string, number>
    expect(body[userId]).toBeUndefined()
    expect(body[withFiles]).toBe(300)
  })
})
