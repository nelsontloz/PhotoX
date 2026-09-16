import request from 'supertest'
import { closeTestApp, createApiTestApp, resetDb, seedFile, seedUser, apiServer } from './helpers'
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
})
