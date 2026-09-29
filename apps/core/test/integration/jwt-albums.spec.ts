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

describe('albums JWT identity', () => {
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
    const res = await request(apiServer(t))
      .post('/api/v1/albums')
      .set(t.authHeader(tokenA))
      .send({ name: 'Trip', userId: b.id })
    expect(res.status).toBe(201)
    const body = res.body as unknown as { userId: string; name: string }
    expect(body.userId).toBe(a.id)
    expect(body.name).toBe('Trip')
  })

  it('lists without userId and ignores query userId', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    await request(apiServer(t))
      .post('/api/v1/albums')
      .set(t.authHeader(tokenA))
      .send({ name: 'Mine' })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    await request(apiServer(t))
      .post('/api/v1/albums')
      .set(t.authHeader(tokenB))
      .send({ name: 'Theirs' })
    const res = await request(apiServer(t))
      .get('/api/v1/albums')
      .query({ userId: b.id })
      .set(t.authHeader(tokenA))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { userId: string }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]?.userId).toBe(a.id)
  })

  it('scopes get, update and delete to JWT user', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const created = await request(apiServer(t))
      .post('/api/v1/albums')
      .set(t.authHeader(tokenA))
      .send({ name: 'Mine' })
    const album = created.body as unknown as { id: string }
    const crossGet = await request(apiServer(t))
      .get(`/api/v1/albums/${album.id}`)
      .query({ userId: a.id })
      .set(t.authHeader(tokenB))
    expect(crossGet.status).toBe(404)
    const ownGet = await request(apiServer(t))
      .get(`/api/v1/albums/${album.id}`)
      .set(t.authHeader(tokenA))
    expect(ownGet.status).toBe(200)
    const crossPatch = await request(apiServer(t))
      .patch(`/api/v1/albums/${album.id}`)
      .set(t.authHeader(tokenB))
      .send({ name: 'Hijack' })
    expect(crossPatch.status).toBe(404)
    const ownPatch = await request(apiServer(t))
      .patch(`/api/v1/albums/${album.id}`)
      .set(t.authHeader(tokenA))
      .send({ name: 'Renamed' })
    expect(ownPatch.status).toBe(200)
    const crossDelete = await request(apiServer(t))
      .delete(`/api/v1/albums/${album.id}`)
      .set(t.authHeader(tokenB))
    expect(crossDelete.status).toBe(404)
  })

  it('adds, lists and removes album assets without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)
    const thumbFile = await seedFile(t, user.id)
    await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        fileId: thumbFile.id,
        size: 'md',
        width: 512,
        height: 512,
        bytes: 4096,
      }),
    )
    const created = await request(apiServer(t))
      .post('/api/v1/albums')
      .set(t.authHeader(token))
      .send({ name: 'Trip' })
    const album = created.body as unknown as { id: string }
    const add = await request(apiServer(t))
      .post(`/api/v1/albums/${album.id}/assets`)
      .set(t.authHeader(token))
      .send({ assetIds: [asset.id] })
    expect(add.status).toBe(201)
    const list = await request(apiServer(t))
      .get(`/api/v1/albums/${album.id}/assets`)
      .set(t.authHeader(token))
    expect(list.status).toBe(200)
    const listBody = list.body as unknown as {
      items: { id: string; thumbnails?: { size: string; fileId: string }[]; uploadedAt: string }[]
      total: number
    }
    expect(listBody.total).toBe(1)
    expect(listBody.items[0]?.thumbnails).toEqual(
      expect.arrayContaining([expect.objectContaining({ size: 'md', fileId: thumbFile.id })]),
    )
    expect(listBody.items[0]?.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const remove = await request(apiServer(t))
      .delete(`/api/v1/albums/${album.id}/assets/${asset.id}`)
      .set(t.authHeader(token))
    expect(remove.status).toBe(204)
  })

  it('rejects cross-user album asset add and remove', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const created = await request(apiServer(t))
      .post('/api/v1/albums')
      .set(t.authHeader(tokenA))
      .send({ name: 'Mine' })
    const album = created.body as unknown as { id: string }

    const crossAdd = await request(apiServer(t))
      .post(`/api/v1/albums/${album.id}/assets`)
      .set(t.authHeader(tokenB))
      .send({ assetIds: [asset.id] })
    expect(crossAdd.status).toBe(404)

    const ownAdd = await request(apiServer(t))
      .post(`/api/v1/albums/${album.id}/assets`)
      .set(t.authHeader(tokenA))
      .send({ assetIds: [asset.id] })
    expect(ownAdd.status).toBe(201)

    const crossRemove = await request(apiServer(t))
      .delete(`/api/v1/albums/${album.id}/assets/${asset.id}`)
      .set(t.authHeader(tokenB))
    expect(crossRemove.status).toBe(404)
    expect(await t.albumAssetRepo.count({ where: { albumId: album.id, assetId: asset.id } })).toBe(
      1,
    )
  })

  it('rejects invalid album body with 400', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t)).post('/api/v1/albums').set(t.authHeader(token)).send({})
    expect(res.status).toBe(400)
  })

  it('returns 401 without token', async () => {
    const res = await request(apiServer(t)).get('/api/v1/albums')
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed token', async () => {
    const res = await request(apiServer(t))
      .get('/api/v1/albums')
      .set({ Authorization: 'Bearer not-a-token' })
    expect(res.status).toBe(401)
  })

  it.each([
    ['post', '/api/v1/albums', { name: 'Nope' }],
    ['get', `/api/v1/albums/${randomUUID()}`],
    ['patch', `/api/v1/albums/${randomUUID()}`, { name: 'Nope' }],
    ['delete', `/api/v1/albums/${randomUUID()}`],
    ['post', `/api/v1/albums/${randomUUID()}/assets`, { assetIds: [] }],
    ['delete', `/api/v1/albums/${randomUUID()}/assets/${randomUUID()}`],
    ['get', `/api/v1/albums/${randomUUID()}/assets`],
  ] as ['get' | 'post' | 'patch' | 'delete', string, object?][])(
    'returns 401 for %s %s without token',
    async (method, path, body) => {
      const agent = request(apiServer(t))
      const req = agent[method](path)
      const res = await (body ? req.send(body) : req)
      expect(res.status).toBe(401)
    },
  )

  it('returns 404 for an unknown album on get, patch and delete', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const missing = randomUUID()

    const get = await request(apiServer(t))
      .get(`/api/v1/albums/${missing}`)
      .set(t.authHeader(token))
    expect(get.status).toBe(404)

    const patch = await request(apiServer(t))
      .patch(`/api/v1/albums/${missing}`)
      .set(t.authHeader(token))
      .send({ name: 'Nope' })
    expect(patch.status).toBe(404)

    const del = await request(apiServer(t))
      .delete(`/api/v1/albums/${missing}`)
      .set(t.authHeader(token))
    expect(del.status).toBe(404)
  })

  it('returns 404 when adding assets to an unknown album or asset', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const unknownAlbum = await request(apiServer(t))
      .post(`/api/v1/albums/${randomUUID()}/assets`)
      .set(t.authHeader(token))
      .send({ assetIds: [randomUUID()] })
    expect(unknownAlbum.status).toBe(404)

    const created = await request(apiServer(t))
      .post('/api/v1/albums')
      .set(t.authHeader(token))
      .send({ name: 'Trip' })
    expect(created.status).toBe(201)
    const album = created.body as unknown as { id: string }

    const unknownAsset = await request(apiServer(t))
      .post(`/api/v1/albums/${album.id}/assets`)
      .set(t.authHeader(token))
      .send({ assetIds: [randomUUID()] })
    expect(unknownAsset.status).toBe(404)
  })
})
