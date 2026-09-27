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

  it('creates without userId and ignores body userId', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(tokenA))
      .send({ assetId: asset.id, userId: b.id })
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
})
