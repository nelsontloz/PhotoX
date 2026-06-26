import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, uploadForUser } from './helpers'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/files/:fileId/stream — range support', () => {
  it('UC-RNG-1: range request returns 206 with partial body and Content-Range', async () => {
    const userId = mintUserId()
    const content = Buffer.from('X'.repeat(1024))
    const record = await uploadForUser(
      httpServer,
      userId,
      'big.bin',
      content,
      'application/octet-stream',
    )

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/stream`)
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (c: Buffer) => chunks.push(c))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(206)

    const body = res.body as Buffer
    expect(body.length).toBe(100)
    expect(body.equals(Buffer.from('X'.repeat(100)))).toBe(true)
    expect(res.headers['content-range']).toBe('bytes 0-99/1024')
    expect(res.headers['content-length']).toBe('100')
  })

  it('UC-RNG-2: range past end returns 416 with Content-Range: bytes */<size>', async () => {
    const userId = mintUserId()
    const content = Buffer.from('short')
    const record = await uploadForUser(
      httpServer,
      userId,
      'tiny.bin',
      content,
      'application/octet-stream',
    )

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}/stream`)
      .set('Range', 'bytes=10000-20000')
      .expect(416)

    expect(res.headers['content-range']).toBe(`bytes */${content.length}`)
  })

  it('UC-RNG-3: full response on 200 sets Accept-Ranges: bytes', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(
      httpServer,
      userId,
      'full.bin',
      Buffer.from('full-body'),
      'application/octet-stream',
    )

    const res = await supertest(httpServer).get(`/v1/files/${record.id}/stream`).expect(200)

    expect(res.headers['accept-ranges']).toBe('bytes')
  })
})
