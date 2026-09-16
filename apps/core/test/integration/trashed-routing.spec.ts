import request from 'supertest'
import { closeTestApp, createApiTestApp, resetDb, seedAsset, seedFile, seedUser, apiServer } from './helpers'
import type { ApiTestApp } from './helpers'

describe('trashed routing', () => {
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

  it('serves trashed list without :id shadowing and gets by uuid', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const activeFile = await seedFile(t, user.id)
    const active = await seedAsset(t, user.id, activeFile.id)
    const trashedFile = await seedFile(t, user.id)
    const trashed = await seedAsset(t, user.id, trashedFile.id, { isTrashed: true })
    const list = await request(apiServer(t)).get('/api/v1/assets/trashed').set(t.authHeader(token))
    expect(list.status).toBe(200)
    const body = list.body as unknown as { items: { id: string; isTrashed: boolean }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.id).toBe(trashed.id)
    expect(body.items[0]?.isTrashed).toBe(true)
    const one = await request(apiServer(t)).get(`/api/v1/assets/${active.id}`).set(t.authHeader(token))
    expect(one.status).toBe(200)
    const oneBody = one.body as unknown as { id: string }
    expect(oneBody.id).toBe(active.id)
  })
})
