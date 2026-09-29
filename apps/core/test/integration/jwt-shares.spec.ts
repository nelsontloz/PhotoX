import { randomUUID } from 'node:crypto'
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

describe('shares JWT identity', () => {
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

  it('creates a share for the JWT user', async () => {
    const a = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(tokenA))
      .send({ assetId: asset.id })
    expect(res.status).toBe(201)
    const body = res.body as unknown as { userId: string; assetId: string; token: string }
    expect(body.userId).toBe(a.id)
    expect(body.assetId).toBe(asset.id)
    expect(typeof body.token).toBe('string')
  })

  it('lists without userId and ignores query userId', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const fileA = await seedFile(t, a.id)
    const assetA = await seedAsset(t, a.id, fileA.id)
    await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(tokenA))
      .send({ assetId: assetA.id })
    const fileB = await seedFile(t, b.id)
    const assetB = await seedAsset(t, b.id, fileB.id)
    await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(tokenB))
      .send({ assetId: assetB.id })
    const res = await request(apiServer(t))
      .get('/api/v1/shares')
      .query({ userId: b.id })
      .set(t.authHeader(tokenA))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { userId: string }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.userId).toBe(a.id)
  })

  it('keeps share lists isolated per user', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const fileA = await seedFile(t, a.id)
    const assetA = await seedAsset(t, a.id, fileA.id)
    const fileB = await seedFile(t, b.id)
    const assetB = await seedAsset(t, b.id, fileB.id)
    await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(tokenA))
      .send({ assetId: assetA.id })
    await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(tokenB))
      .send({ assetId: assetB.id })

    const listA = await request(apiServer(t)).get('/api/v1/shares').set(t.authHeader(tokenA))
    const listB = await request(apiServer(t)).get('/api/v1/shares').set(t.authHeader(tokenB))
    expect(listA.status).toBe(200)
    expect(listB.status).toBe(200)
    const itemsA = (listA.body as unknown as { items: { userId: string; assetId: string }[] }).items
    const itemsB = (listB.body as unknown as { items: { userId: string; assetId: string }[] }).items
    expect(itemsA).toHaveLength(1)
    expect(itemsA[0]?.userId).toBe(a.id)
    expect(itemsA[0]?.assetId).toBe(assetA.id)
    expect(itemsB).toHaveLength(1)
    expect(itemsB[0]?.userId).toBe(b.id)
    expect(itemsB[0]?.assetId).toBe(assetB.id)
  })

  it('rejects cross-user revoke', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const created = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(tokenA))
      .send({ assetId: asset.id })
    const share = created.body as unknown as { id: string }
    const cross = await request(apiServer(t))
      .delete(`/api/v1/shares/${share.id}`)
      .set(t.authHeader(tokenB))
    expect(cross.status).toBe(404)
    const own = await request(apiServer(t))
      .delete(`/api/v1/shares/${share.id}`)
      .set(t.authHeader(tokenA))
    expect(own.status).toBe(204)
  })

  it('serves public share by token without auth', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)
    const created = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(token))
      .send({ assetId: asset.id })
    const share = created.body as unknown as { token: string }
    const res = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect(res.status).toBe(200)
  })

  it('returns 401 without token', async () => {
    const res = await request(apiServer(t)).get('/api/v1/shares')
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed token', async () => {
    const res = await request(apiServer(t))
      .get('/api/v1/shares')
      .set({ Authorization: 'Bearer not-a-token' })
    expect(res.status).toBe(401)
  })

  it.each([
    ['post', '/api/v1/shares', { assetId: randomUUID() }],
    ['delete', `/api/v1/shares/${randomUUID()}`],
  ] as ['get' | 'post' | 'delete', string, object?][])(
    'returns 401 for %s %s without token',
    async (method, path, body) => {
      const agent = request(apiServer(t))
      const req = agent[method](path)
      const res = await (body ? req.send(body) : req)
      expect(res.status).toBe(401)
    },
  )

  it('returns the same token when sharing the same asset twice', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)

    const first = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(token))
      .send({ assetId: asset.id })
    const second = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(token))
      .send({ assetId: asset.id })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const firstBody = first.body as unknown as { id: string; token: string }
    const secondBody = second.body as unknown as { id: string; token: string }
    expect(secondBody.id).toBe(firstBody.id)
    expect(secondBody.token).toBe(firstBody.token)
    expect(await t.shareRepo.count({ where: { assetId: asset.id } })).toBe(1)
  })

  it('404s the public route after revoke', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)
    const created = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(token))
      .send({ assetId: asset.id })
    const share = created.body as unknown as { id: string; token: string }

    const revoked = await request(apiServer(t))
      .delete(`/api/v1/shares/${share.id}`)
      .set(t.authHeader(token))
    expect(revoked.status).toBe(204)
    const res = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect(res.status).toBe(404)
  })

  it('excludes trashed assets from the share list and the public route', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)
    const created = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(token))
      .send({ assetId: asset.id })
    const share = created.body as unknown as { token: string }

    const trashed = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/trash`)
      .set(t.authHeader(token))
    expect(trashed.status).toBe(204)

    const list = await request(apiServer(t)).get('/api/v1/shares').set(t.authHeader(token))
    expect(list.status).toBe(200)
    expect((list.body as unknown as { items: unknown[] }).items).toHaveLength(0)

    const pub = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect(pub.status).toBe(404)
  })

  it('does not leak exif, gps or faces through the public projection', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)
    await t.assetRepo.update(asset.id, {
      latitude: 48.8584,
      longitude: 2.2945,
      altitude: 35,
      cameraMake: 'Leica',
      cameraModel: 'M11',
      lensModel: 'Summicron',
      iso: 400,
      fNumber: 2,
      exposureTime: 0.008,
      focalLength: 35,
      metadata: { gps: { lat: 48.8584, lon: 2.2945 }, exif: { Make: 'Leica' } },
      faceCount: 2,
    })
    const created = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(token))
      .send({ assetId: asset.id })
    const share = created.body as unknown as { token: string }

    const res = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect(res.status).toBe(200)
    const body = res.body as unknown as {
      share: Record<string, unknown>
      asset: Record<string, unknown>
    }
    const forbidden = [
      'latitude',
      'longitude',
      'altitude',
      'cameraMake',
      'cameraModel',
      'lensModel',
      'iso',
      'fNumber',
      'exposureTime',
      'focalLength',
      'metadata',
      'faceCount',
      'faces',
      'gps',
      'exif',
    ]
    for (const key of forbidden) {
      expect(body.asset).not.toHaveProperty(key)
      expect(body.share).not.toHaveProperty(key)
    }
    expect(JSON.stringify(body)).not.toContain('48.8584')
    expect(JSON.stringify(body)).not.toContain('Summicron')
  })
})
