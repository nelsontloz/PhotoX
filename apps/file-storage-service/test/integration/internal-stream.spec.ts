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

describe('GET /v1/internal/files/:fileId/stream', () => {
  it('UC-I4: streams raw bytes with correct Content-Type and body sha256', async () => {
    const userId = mintUserId()
    const content = Buffer.from('stream-this-bytes')
    const record = await uploadForUser(
      httpServer,
      userId,
      'data.bin',
      content,
      'application/octet-stream',
    )

    const res = await supertest(httpServer)
      .get(`/v1/internal/files/${record.id}/stream`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)

    expect(res.headers['content-type']).toBe('application/octet-stream')
    expect(res.headers['content-disposition']).toBe('attachment; filename="data.bin"')
    expect(sha256(res.body as Buffer)).toBe(record.checksumSha256)
  })

  it('returns 404 for a non-existent file', async () => {
    await supertest(httpServer)
      .get('/v1/internal/files/00000000-0000-0000-0000-000000000000/stream')
      .expect(404)
  })
})
