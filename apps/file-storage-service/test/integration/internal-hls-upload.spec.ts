import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { MinioService } from '../../src/storage/minio.service'
import { loadEnv } from '@photox/shared-config'
import { createTestApp, closeTestApp, mintUserId } from './helpers'

interface UploadResponse {
  uploaded: number
}

interface ErrorBody {
  message: string
}

let app: INestApplication
let httpServer: Server
let minioService: MinioService

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
  minioService = app.get(MinioService)
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

const attach = (req: supertest.Test, name: string, mimeType: string) =>
  req.attach('files', Buffer.from(`bytes-of-${name}`), { filename: name, contentType: mimeType })

describe('POST /v1/internal/hls/files/batch', () => {
  it('UC-HLS-U1: uploads a batch of segments, objects land at ${userId}/${fileId}/hls/<path>', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()
    const env = loadEnv()
    const paths = ['seg_000.ts', 'seg_001.ts', 'playlist.m3u8']

    let req = supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('userId', userId)
      .field('fileId', fileId)
      .field('paths', JSON.stringify(paths))
    req = attach(req, paths[0]!, 'video/mp2t')
    req = attach(req, paths[1]!, 'video/mp2t')
    req = attach(req, paths[2]!, 'application/vnd.apple.mpegurl')

    const res = await req.expect(201)
    expect((res.body as UploadResponse).uploaded).toBe(3)

    const client = minioService.getClient()
    const objects = await new Promise<string[]>((resolve, reject) => {
      const keys: string[] = []
      const stream = client.listObjects(env.MINIO_BUCKET, `${userId}/${fileId}/hls/`, false)
      stream.on('data', (obj) => {
        if (obj.name) keys.push(obj.name)
      })
      stream.on('end', () => resolve(keys))
      stream.on('error', reject)
    })

    for (const p of paths) {
      expect(objects).toContain(`${userId}/${fileId}/hls/${p}`)
    }
  })

  it('UC-HLS-U2: paths/files length mismatch returns 400', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()

    const res = await supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('userId', userId)
      .field('fileId', fileId)
      .field('paths', JSON.stringify(['a.ts', 'b.ts']))
      .attach('files', Buffer.from('a'), { filename: 'a.ts', contentType: 'video/mp2t' })
      .expect(400)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-HLS-U3: missing userId returns 400', async () => {
    const fileId = randomUUID()

    await supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('fileId', fileId)
      .field('paths', JSON.stringify(['a.ts']))
      .attach('files', Buffer.from('a'), { filename: 'a.ts', contentType: 'video/mp2t' })
      .expect(400)
  })

  it('UC-HLS-U3: missing fileId returns 400', async () => {
    const userId = mintUserId()

    await supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('userId', userId)
      .field('paths', JSON.stringify(['a.ts']))
      .attach('files', Buffer.from('a'), { filename: 'a.ts', contentType: 'video/mp2t' })
      .expect(400)
  })

  it('UC-HLS-U3: 0 files returns 400', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()

    await supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('userId', userId)
      .field('fileId', fileId)
      .field('paths', JSON.stringify(['a.ts']))
      .expect(400)
  })

  it('UC-HLS-U4: path with ".." segment is rejected (no traversal)', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()

    const res = await supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('userId', userId)
      .field('fileId', fileId)
      .field('paths', JSON.stringify(['../etc/passwd']))
      .attach('files', Buffer.from('x'), {
        filename: 'passwd',
        contentType: 'application/octet-stream',
      })
      .expect(400)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-HLS-U4: absolute path is rejected', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()

    const res = await supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('userId', userId)
      .field('fileId', fileId)
      .field('paths', JSON.stringify(['/absolute/foo.ts']))
      .attach('files', Buffer.from('x'), { filename: 'foo.ts', contentType: 'video/mp2t' })
      .expect(400)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-HLS-U5: paths must be a JSON array of strings (numbers rejected)', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()

    await supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('userId', userId)
      .field('fileId', fileId)
      .field('paths', JSON.stringify([1, 2, 3]))
      .attach('files', Buffer.from('x'), { filename: 'x', contentType: 'video/mp2t' })
      .expect(400)
  })

  it('UC-HLS-U5: paths is not JSON returns 400', async () => {
    const userId = mintUserId()
    const fileId = randomUUID()

    await supertest(httpServer)
      .post('/v1/internal/hls/files/batch')
      .field('userId', userId)
      .field('fileId', fileId)
      .field('paths', 'not-json-at-all')
      .attach('files', Buffer.from('x'), { filename: 'x', contentType: 'video/mp2t' })
      .expect(400)
  })
})
