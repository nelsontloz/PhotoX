import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import request from 'supertest'
import {
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
  apiServer,
} from './helpers'
import type { ApiTestApp } from './helpers'

describe('files JWT identity', () => {
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

  it('lists without userId and ignores query userId', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    await seedFile(t, a.id)
    await seedFile(t, b.id)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const res = await request(apiServer(t))
      .get('/api/v1/files')
      .query({ userId: b.id })
      .set(t.authHeader(tokenA))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { userId: string }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]?.userId).toBe(a.id)
  })

  it('gets and downloads own file without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const record = await seedFile(t, user.id, { bytes: Buffer.from('hello-bytes') })
    const get = await request(apiServer(t))
      .get(`/api/v1/files/${record.id}`)
      .set(t.authHeader(token))
    expect(get.status).toBe(200)
    const download = await request(apiServer(t))
      .get(`/api/v1/files/${record.id}/download`)
      .set(t.authHeader(token))
    expect(download.status).toBe(200)
  })

  it('rejects cross-user file access even with userId query', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const record = await seedFile(t, a.id)
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${record.id}`)
      .query({ userId: a.id })
      .set(t.authHeader(tokenB))
    expect(res.status).toBe(404)
  })

  it('deletes without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const record = await seedFile(t, user.id)
    const res = await request(apiServer(t))
      .delete(`/api/v1/files/${record.id}`)
      .set(t.authHeader(token))
    expect(res.status).toBe(204)
  })

  it('streams publicly without token', async () => {
    const user = await seedUser(t)
    const record = await seedFile(t, user.id, { bytes: Buffer.from('stream-bytes') })
    const res = await request(apiServer(t)).get(`/api/v1/files/${record.id}/stream`)
    expect(res.status).toBe(200)
  })

  it('returns 401 without token', async () => {
    const res = await request(apiServer(t)).get('/api/v1/files')
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed token', async () => {
    const res = await request(apiServer(t))
      .get('/api/v1/files')
      .set({ Authorization: 'Bearer not-a-token' })
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown file id', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${randomUUID()}`)
      .set(t.authHeader(token))
    expect(res.status).toBe(404)
  })

  it('deletes an unknown file id idempotently with 204', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t))
      .delete(`/api/v1/files/${randomUUID()}`)
      .set(t.authHeader(token))
    expect(res.status).toBe(204)
  })

  async function writeBytes(
    kind: 'original' | 'thumbnail' | 'transcode',
    userId: string,
    id: string,
    ext: string,
    bytes: Buffer,
  ): Promise<string> {
    const storageKey = t.storage.buildKey(kind, userId, id, ext)
    await mkdir(dirname(t.storage.pathFor(storageKey)), { recursive: true })
    await writeFile(t.storage.pathFor(storageKey), bytes)
    return storageKey
  }

  function registerBody(bytes: Buffer, overrides: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      kind: 'original',
      ext: 'jpg',
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.length,
      ...overrides,
    }
  }

  it('registers a file with a core-computed storage key', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const bytes = Buffer.from('register-thumb-bytes')
    const id = randomUUID()
    const storageKey = await writeBytes('thumbnail', user.id, id, 'webp', bytes)

    const res = await request(apiServer(t))
      .post('/api/v1/files/register')
      .set(t.authHeader(token))
      .send(
        registerBody(bytes, {
          id,
          kind: 'thumbnail',
          ext: 'webp',
          originalName: 'thumb.webp',
          mimeType: 'image/webp',
        }),
      )
    expect(res.status).toBe(201)
    const row = await t.fileRepo.findOne({ where: { id } })
    expect(row?.storageKey).toBe(storageKey)
    expect(row?.purpose).toBe('original')
    expect(row?.userId).toBe(user.id)
    expect(row?.assetId).toBeNull()
    expect(res.body).toMatchObject({ id, storageKey, purpose: 'original', userId: user.id })
  })

  it('registers a transcode against an owned asset', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const source = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, source.id, { kind: 'video' })
    const bytes = Buffer.from('register-transcode-bytes')
    const id = randomUUID()
    const storageKey = await writeBytes('transcode', user.id, id, 'webm', bytes)

    const res = await request(apiServer(t))
      .post('/api/v1/files/register')
      .set(t.authHeader(token))
      .send(registerBody(bytes, { id, kind: 'transcode', ext: 'webm', assetId: asset.id }))
    expect(res.status).toBe(201)
    const row = await t.fileRepo.findOne({ where: { id } })
    expect(row?.storageKey).toBe(storageKey)
    expect(row?.purpose).toBe('transcode')
    expect(row?.assetId).toBe(asset.id)
  })

  it('returns the existing file for a duplicate checksum', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const bytes = Buffer.from('register-dedupe-bytes')
    const firstId = randomUUID()
    await writeBytes('original', user.id, firstId, 'jpg', bytes)

    const first = await request(apiServer(t))
      .post('/api/v1/files/register')
      .set(t.authHeader(token))
      .send(registerBody(bytes, { id: firstId }))
    expect(first.status).toBe(201)

    const second = await request(apiServer(t))
      .post('/api/v1/files/register')
      .set(t.authHeader(token))
      .send(registerBody(bytes))
    expect(second.status).toBe(200)
    const body = second.body as unknown as { id: string }
    expect(body.id).toBe(firstId)
    expect(await t.fileRepo.count()).toBe(1)
  })

  it('rejects a re-used file id with 409', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const id = randomUUID()
    const bytes = Buffer.from('register-collision-bytes')
    await writeBytes('original', user.id, id, 'jpg', bytes)

    const first = await request(apiServer(t))
      .post('/api/v1/files/register')
      .set(t.authHeader(token))
      .send(registerBody(bytes, { id }))
    expect(first.status).toBe(201)

    const second = await request(apiServer(t))
      .post('/api/v1/files/register')
      .set(t.authHeader(token))
      .send(registerBody(Buffer.from('different-bytes'), { id }))
    expect(second.status).toBe(409)
  })

  it('rejects a foreign asset with 404', async () => {
    const owner = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: other.id, email: other.email, role: other.role })
    const source = await seedFile(t, owner.id)
    const asset = await seedAsset(t, owner.id, source.id)

    const res = await request(apiServer(t))
      .post('/api/v1/files/register')
      .set(t.authHeader(token))
      .send(registerBody(Buffer.from('foreign-asset-bytes'), { assetId: asset.id }))
    expect(res.status).toBe(404)
  })

  it('rejects invalid registration payloads with 400', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const valid = registerBody(Buffer.from('register-validation-bytes'))
    const payloads = [
      { ...valid, checksumSha256: 'z'.repeat(64) },
      { ...valid, checksumSha256: 'a'.repeat(63) },
      { ...valid, ext: 'JPEG' },
      { ...valid, ext: 'toolongext' },
      { ...valid, kind: 'sidecar' },
      { ...valid, sizeBytes: -1 },
      { ...valid, unknownField: 'nope' },
    ]
    for (const payload of payloads) {
      const res = await request(apiServer(t))
        .post('/api/v1/files/register')
        .set(t.authHeader(token))
        .send(payload)
      expect(res.status).toBe(400)
    }
  })

  it('returns 422 when registered bytes are missing from storage', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t))
      .post('/api/v1/files/register')
      .set(t.authHeader(token))
      .send(registerBody(Buffer.from('register-missing-bytes')))
    expect(res.status).toBe(422)
  })
})
