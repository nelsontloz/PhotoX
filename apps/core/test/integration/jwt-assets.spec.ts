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

describe('assets JWT identity', () => {
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

  it('lists without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    await seedAsset(t, user.id, file.id)
    const res = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { id: string }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
  })

  it('ignores supplied userId on list', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const fileA = await seedFile(t, a.id)
    await seedAsset(t, a.id, fileA.id)
    const fileB = await seedFile(t, b.id)
    await seedAsset(t, b.id, fileB.id)
    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ userId: b.id })
      .set(t.authHeader(tokenA))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { userId: string }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]?.userId).toBe(a.id)
  })

  it('gets own asset without userId and 404s cross-user even with userId query', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const own = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(tokenA))
    expect(own.status).toBe(200)
    const cross = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .query({ userId: a.id })
      .set(t.authHeader(tokenB))
    expect(cross.status).toBe(404)
  })

  it('updates without userId and ignores body userId', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(tokenA))
      .send({ favorite: true, userId: b.id })
    expect(res.status).toBe(200)
    const body = res.body as unknown as { userId: string; favorite: boolean }
    expect(body.userId).toBe(a.id)
    expect(body.favorite).toBe(true)
  })

  it('rejects cross-user update', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(tokenB))
      .send({ favorite: true })
    expect(res.status).toBe(404)
  })

  it('trashes and bulk-trashes without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const fileOne = await seedFile(t, user.id)
    const assetOne = await seedAsset(t, user.id, fileOne.id)
    const fileTwo = await seedFile(t, user.id)
    const assetTwo = await seedAsset(t, user.id, fileTwo.id)
    const trash = await request(apiServer(t))
      .post(`/api/v1/assets/${assetOne.id}/trash`)
      .set(t.authHeader(token))
    expect(trash.status).toBe(204)
    const bulk = await request(apiServer(t))
      .post('/api/v1/assets/bulk-trash')
      .set(t.authHeader(token))
      .send({ assetIds: [assetTwo.id] })
    expect(bulk.status).toBe(204)
  })

  it('rejects invalid asset update body with 400', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(token))
      .send({ favorite: 'yes' })
    expect(res.status).toBe(400)
  })

  it('returns 401 without token', async () => {
    const res = await request(apiServer(t)).get('/api/v1/assets')
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed token', async () => {
    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .set({ Authorization: 'Bearer not-a-token' })
    expect(res.status).toBe(401)
  })
})
