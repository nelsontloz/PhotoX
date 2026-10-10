import { createHash } from 'node:crypto'
import request from 'supertest'
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
} from './helpers'
import type { ApiTestApp } from './helpers'

const FILE_BYTES = Buffer.from('0123456789')
const FILE_ETAG = `"${createHash('sha256').update(FILE_BYTES).digest('hex')}"`
const BYTES_CACHE_CONTROL = 'private, max-age=31536000, immutable'

function expectBytes(body: unknown, expected: string) {
  expect(Buffer.isBuffer(body)).toBe(true)
  expect((body as Buffer).toString('utf8')).toBe(expected)
}

describe('HTTP range streaming', () => {
  let t: ApiTestApp

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
  })

  async function seedStreamableFile() {
    const user = await seedUser(t)
    const file = await seedFile(t, user.id, {
      bytes: FILE_BYTES,
      mimeType: 'application/octet-stream',
    })
    const auth = t.authHeader(t.signToken(user))
    return { user, file, auth }
  }

  it('serves the full body with auth and no Range (200)', async () => {
    const { file, auth } = await seedStreamableFile()
    const res = await request(apiServer(t)).get(`/api/v1/files/${file.id}/stream`).set(auth)
    expect(res.status).toBe(200)
    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(res.headers['content-length']).toBe('10')
    expect(res.headers.etag).toBe(FILE_ETAG)
    expect(res.headers['cache-control']).toBe(BYTES_CACHE_CONTROL)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="photo.png"; filename*=UTF-8''photo.png`,
    )
    expectBytes(res.body, '0123456789')
  })

  it('serves bytes=0-3 as 206 with Content-Range', async () => {
    const { file, auth } = await seedStreamableFile()
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream`)
      .set(auth)
      .set('Range', 'bytes=0-3')
    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 0-3/10')
    expect(res.headers['content-length']).toBe('4')
    expect(res.headers.etag).toBe(FILE_ETAG)
    expect(res.headers['cache-control']).toBe(BYTES_CACHE_CONTROL)
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="photo.png"; filename*=UTF-8''photo.png`,
    )
    expectBytes(res.body, '0123')
  })

  it('serves an open-ended bytes=5- range to end of file', async () => {
    const { file, auth } = await seedStreamableFile()
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream`)
      .set(auth)
      .set('Range', 'bytes=5-')
    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 5-9/10')
    expectBytes(res.body, '56789')
  })

  it('returns 416 for an unsatisfiable bytes=999- range', async () => {
    const { file, auth } = await seedStreamableFile()
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream`)
      .set(auth)
      .set('Range', 'bytes=999-')
    expect(res.status).toBe(416)
    expect(res.headers['content-range']).toBe('bytes */10')
  })

  it('returns 304 for a full GET whose If-None-Match matches', async () => {
    const { file, auth } = await seedStreamableFile()
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream`)
      .set(auth)
      .set('If-None-Match', FILE_ETAG)
    expect(res.status).toBe(304)
    expect(res.headers.etag).toBe(FILE_ETAG)
    expect(res.headers['content-type']).toBeUndefined()
    expect(res.headers['content-length']).toBeUndefined()
    expect(res.headers['content-disposition']).toBeUndefined()
  })

  it('still answers 206 when a Range request also carries a matching If-None-Match', async () => {
    const { file, auth } = await seedStreamableFile()
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream`)
      .set(auth)
      .set('Range', 'bytes=0-3')
      .set('If-None-Match', FILE_ETAG)
    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 0-3/10')
    expectBytes(res.body, '0123')
  })

  it('streams a shared asset publicly with Range (206)', async () => {
    const { user, file } = await seedStreamableFile()
    const asset = await seedAsset(t, user.id, file.id)
    const share = await t.shareRepo.save(
      t.shareRepo.create({
        userId: user.id,
        kind: 'asset',
        assetId: asset.id,
        token: 'share-token-123',
      }),
    )
    const res = await request(apiServer(t))
      .get(`/api/share/${share.token}/stream`)
      .set('Range', 'bytes=2-4')
    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 2-4/10')
    expect(res.headers.etag).toBe(FILE_ETAG)
    expect(res.headers['cache-control']).toBe(BYTES_CACHE_CONTROL)
    expectBytes(res.body, '234')
  })

  it('serves a shared asset fully with cache headers, then 304s on If-None-Match', async () => {
    const { user, file } = await seedStreamableFile()
    const asset = await seedAsset(t, user.id, file.id)
    const share = await t.shareRepo.save(
      t.shareRepo.create({
        userId: user.id,
        kind: 'asset',
        assetId: asset.id,
        token: 'share-token-full',
      }),
    )
    const first = await request(apiServer(t)).get(`/api/share/${share.token}/stream`)
    expect(first.status).toBe(200)
    expect(first.headers.etag).toBe(FILE_ETAG)
    expect(first.headers['cache-control']).toBe(BYTES_CACHE_CONTROL)
    expectBytes(first.body, '0123456789')

    const second = await request(apiServer(t))
      .get(`/api/share/${share.token}/stream`)
      .set('If-None-Match', FILE_ETAG)
    expect(second.status).toBe(304)
    expect(second.headers.etag).toBe(FILE_ETAG)
  })

  it('sanitizes a hostile filename in the download Content-Disposition', async () => {
    const user = await seedUser(t)
    const file = await seedFile(t, user.id, { originalName: 'x";\r\nX-Evil: 1.png' })
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/download`)
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const disposition = res.headers['content-disposition'] ?? ''
    expect(disposition).not.toMatch(/[\r\n]/)
    expect(disposition).toBe(
      `attachment; filename="x____X-Evil: 1.png"; filename*=UTF-8''x%22%3B%0D%0AX-Evil%3A%201.png`,
    )
  })
})
