import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, uploadForUser, sha256 } from './helpers'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/files/:fileId/download', () => {
  it('UC-U7: returns 200 with correct Content-Type, Content-Disposition, and body sha256', async () => {
    const userId = mintUserId()
    const content = Buffer.from('downloadable-content-for-test')
    const record = await uploadForUser(httpServer, userId, 'readme.txt', content, 'text/plain')

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/download`)
      .set('x-user-id', userId)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)

    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.headers['content-disposition']).toBe('attachment; filename="readme.txt"')
    expect(sha256(res.body as Buffer)).toBe(record.checksumSha256)
  })

  it("UC-U8: returns 404 for someone else's file, no byte leak", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const content = Buffer.from('owner-private-data')
    const record = await uploadForUser(httpServer, owner, 'private.txt', content, 'text/plain')

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/download`)
      .set('x-user-id', other)
      .expect(404)

    expect(res.body).toBeDefined()
    expect((res.body as { statusCode: number }).statusCode).toBe(404)
  })

  it('returns 404 for a non-existent file', async () => {
    const userId = mintUserId()

    await supertest(httpServer)
      .get('/v1/files/00000000-0000-0000-0000-000000000000/download')
      .set('x-user-id', userId)
      .expect(404)
  })
})
