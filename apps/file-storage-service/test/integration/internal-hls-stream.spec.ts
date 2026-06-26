import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, sha256 } from './helpers'

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

const uploadSegment = async (
  userId: string,
  fileId: string,
  relPath: string,
  content: Buffer,
  mimeType: string,
) => {
  await supertest(httpServer)
    .post('/v1/internal/hls/files/batch')
    .field('userId', userId)
    .field('fileId', fileId)
    .field('paths', JSON.stringify([relPath]))
    .attach('files', content, { filename: relPath, contentType: mimeType })
    .expect(201)
}

const collectBuffer = (
  response: supertest.Response,
  callback: (err: Error | null, data?: Buffer) => void,
) => {
  const chunks: Buffer[] = []
  response.on('data', (c: Buffer) => chunks.push(c))
  response.on('end', () => callback(null, Buffer.concat(chunks)))
  response.on('error', (e: Error) => callback(e))
}

describe('GET /v1/internal/hls/files/:userId/:fileId/*', () => {
  it('UC-HLS-S1: streams full file (200), correct content-type for .m3u8, body sha matches', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()
    const content = Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n')
    await uploadSegment(userId, fileId, 'master.m3u8', content, 'application/vnd.apple.mpegurl')

    const res = await supertest(httpServer)
      .get(`/v1/internal/hls/files/${userId}/${fileId}/master.m3u8`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (c: Buffer) => chunks.push(c))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)

    expect(res.headers['content-type']).toBe('application/vnd.apple.mpegurl')
    expect(sha256(res.body as Buffer)).toBe(sha256(content))
  })

  it('UC-HLS-S1b: .ts segment gets video/mp2t content-type', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()
    const content = Buffer.from('fake-ts-bytes')
    await uploadSegment(userId, fileId, 'seg_000.ts', content, 'video/mp2t')

    const res = await supertest(httpServer)
      .get(`/v1/internal/hls/files/${userId}/${fileId}/seg_000.ts`)
      .expect(200)

    expect(res.headers['content-type']).toBe('video/mp2t')
  })

  it('UC-HLS-S2: range request returns 206, partial body, content-range header', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()
    const content = Buffer.from('A'.repeat(1024))
    await uploadSegment(userId, fileId, 'range.ts', content, 'video/mp2t')

    const res = await supertest(httpServer)
      .get(`/v1/internal/hls/files/${userId}/${fileId}/range.ts`)
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse(collectBuffer)
      .expect(206)

    const body = res.body as Buffer
    expect(body.length).toBe(100)
    expect(body.equals(Buffer.from('A'.repeat(100)))).toBe(true)
    expect(res.headers['content-range']).toBe('bytes 0-99/1024')
    expect(res.headers['accept-ranges']).toBe('bytes')
  })

  it('UC-HLS-S3: invalid range (past end) returns 400', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()
    const content = Buffer.from('short')
    await uploadSegment(userId, fileId, 'short.ts', content, 'video/mp2t')

    const res = await supertest(httpServer)
      .get(`/v1/internal/hls/files/${userId}/${fileId}/short.ts`)
      .set('Range', 'bytes=10000-20000')
      .expect(400)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-HLS-S4: missing file returns 404', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()

    const res = await supertest(httpServer)
      .get(`/v1/internal/hls/files/${userId}/${fileId}/never.ts`)
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-HLS-S5: nested path under hls/ resolves (sub/file.ts)', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()
    const content = Buffer.from('nested-segment')
    await uploadSegment(userId, fileId, '0/seg_000.m4s', content, 'video/iso.segment')

    const res = await supertest(httpServer)
      .get(`/v1/internal/hls/files/${userId}/${fileId}/0/seg_000.m4s`)
      .buffer(true)
      .parse(collectBuffer)
      .expect(200)

    expect(res.headers['content-type']).toBe('video/iso.segment')
    expect((res.body as Buffer).equals(content)).toBe(true)
  })

  it('UC-HLS-S6: path traversal in URL is normalized by Express — request resolves to the same file, not an escaped key', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()
    const content = Buffer.from('real-segment')
    await uploadSegment(userId, fileId, 'safe.ts', content, 'video/mp2t')

    const res = await supertest(httpServer)
      .get(`/v1/internal/hls/files/${userId}/${fileId}/%2E%2E/${fileId}/safe.ts`)
      .buffer(true)
      .parse(collectBuffer)
      .expect(200)

    expect((res.body as Buffer).equals(content)).toBe(true)
  })
})
