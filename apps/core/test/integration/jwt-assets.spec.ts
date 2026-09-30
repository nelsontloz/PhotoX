import request from 'supertest'
import { randomUUID } from 'node:crypto'
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

  it('lists only the JWT user tokens', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const fileA = await seedFile(t, a.id)
    await seedAsset(t, a.id, fileA.id)
    const fileB = await seedFile(t, b.id)
    await seedAsset(t, b.id, fileB.id)
    const res = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(tokenA))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { userId: string }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]?.userId).toBe(a.id)
  })

  it('isolates list results between two users', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const fileA = await seedFile(t, a.id)
    const assetA = await seedAsset(t, a.id, fileA.id)
    const fileB = await seedFile(t, b.id)
    const assetB = await seedAsset(t, b.id, fileB.id)

    const listA = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(tokenA))
    expect(listA.status).toBe(200)
    const bodyA = listA.body as unknown as { items: { id: string }[]; total: number }
    expect(bodyA.total).toBe(1)
    expect(bodyA.items.map((i) => i.id)).toEqual([assetA.id])

    const listB = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(tokenB))
    expect(listB.status).toBe(200)
    const bodyB = listB.body as unknown as { items: { id: string }[]; total: number }
    expect(bodyB.total).toBe(1)
    expect(bodyB.items.map((i) => i.id)).toEqual([assetB.id])
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

  it('updates the JWT user asset', async () => {
    const a = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(tokenA))
      .send({ favorite: true })
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

  it('rejects cross-user trash and leaves the asset untrashed', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/trash`)
      .set(t.authHeader(tokenB))
    expect(res.status).toBe(404)
    const untouched = await t.assetRepo.findOneByOrFail({ id: asset.id })
    expect(untouched.isTrashed).toBe(false)
  })

  it('does not bulk-trash another user assets', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    // bulk-trash silently filters by owner (idempotent 204); the negative is "no mutation"
    const res = await request(apiServer(t))
      .post('/api/v1/assets/bulk-trash')
      .set(t.authHeader(tokenB))
      .send({ assetIds: [asset.id] })
    expect(res.status).toBe(204)
    const untouched = await t.assetRepo.findOneByOrFail({ id: asset.id })
    expect(untouched.isTrashed).toBe(false)
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

  it('rejects cross-user metadata update without mutating the asset', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const cross = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(tokenB))
      .send({ width: 100 })
    expect(cross.status).toBe(404)
    const untouched = await t.assetRepo.findOneByOrFail({ id: asset.id })
    expect(untouched.width).toBeNull()
    const own = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(tokenA))
      .send({ width: 100 })
    expect(own.status).toBe(200)
    expect((own.body as unknown as { width: number }).width).toBe(100)
  })

  it('accepts negative GPS altitude on metadata update', async () => {
    const a = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(tokenA))
      .send({ altitude: -12.5 })
    expect(res.status).toBe(200)
    expect((res.body as unknown as { altitude: number }).altitude).toBe(-12.5)
    const row = await t.assetRepo.findOneByOrFail({ id: asset.id })
    expect(Number(row.altitude)).toBe(-12.5)
  })

  it('reprocesses owner thumbnails with thumb-reprocess jobIds and rejects cross-user', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/reprocess-thumbnails`)
      .set(t.authHeader(tokenA))
    expect(res.status).toBe(202)
    expect((res.body as unknown as { enqueued: number }).enqueued).toBe(4)
    const queue = t.getQueue('process-thumbnail')
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      const job = await queue.getJob(`thumb-reprocess-${asset.id}-${size}`)
      expect(job).toBeTruthy()
    }
    const cross = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/reprocess-thumbnails`)
      .set(t.authHeader(tokenB))
    expect(cross.status).toBe(404)
  })

  it('rejects reprocess-video on photos and enqueues for owner videos', async () => {
    const user = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const otherToken = t.signToken({ id: other.id, email: other.email, role: other.role })
    const photoFile = await seedFile(t, user.id)
    const photo = await seedAsset(t, user.id, photoFile.id, { kind: 'photo' })
    const videoFile = await seedFile(t, user.id, { mimeType: 'video/mp4' })
    const video = await seedAsset(t, user.id, videoFile.id, { kind: 'video' })
    const notVideo = await request(apiServer(t))
      .post(`/api/v1/assets/${photo.id}/reprocess-video`)
      .set(t.authHeader(token))
    expect(notVideo.status).toBe(400)
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${video.id}/reprocess-video`)
      .set(t.authHeader(token))
    expect(res.status).toBe(202)
    expect((res.body as unknown as { enqueued: number }).enqueued).toBe(1)
    const queue = t.getQueue('process-video')
    const job = await queue.getJob(`video-reprocess-${video.id}`)
    expect(job).toBeTruthy()
    const cross = await request(apiServer(t))
      .post(`/api/v1/assets/${video.id}/reprocess-video`)
      .set(t.authHeader(otherToken))
    expect(cross.status).toBe(404)
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

  // GET /api/v1/assets already has explicit no-token coverage above
  const noTokenRoutes: ['get' | 'patch' | 'post', string][] = [
    ['get', '/api/v1/assets/trashed'],
    ['get', `/api/v1/assets/${randomUUID()}`],
    ['patch', `/api/v1/assets/${randomUUID()}`],
    ['patch', `/api/v1/assets/${randomUUID()}/metadata`],
    ['post', `/api/v1/assets/${randomUUID()}/trash`],
    ['post', '/api/v1/assets/bulk-trash'],
    ['post', `/api/v1/assets/${randomUUID()}/reprocess-thumbnails`],
    ['post', `/api/v1/assets/${randomUUID()}/reprocess-video`],
  ]

  it.each(noTokenRoutes)('returns 401 without token for %s %s', async (method, path) => {
    const res = await request(apiServer(t))[method](path)
    expect(res.status).toBe(401)
  })

  it('returns 404 for get and patch of an unknown asset id', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const id = randomUUID()
    const get = await request(apiServer(t)).get(`/api/v1/assets/${id}`).set(t.authHeader(token))
    expect(get.status).toBe(404)
    const patch = await request(apiServer(t))
      .patch(`/api/v1/assets/${id}`)
      .set(t.authHeader(token))
      .send({ favorite: true })
    expect(patch.status).toBe(404)
  })

  it('paginates assets with limit and offset', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    for (let i = 0; i < 3; i++) {
      const file = await seedFile(t, user.id)
      await seedAsset(t, user.id, file.id)
    }
    const first = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ limit: 2 })
      .set(t.authHeader(token))
    expect(first.status).toBe(200)
    const firstBody = first.body as unknown as {
      items: { id: string }[]
      total: number
      limit: number
      offset: number
    }
    expect(firstBody.total).toBe(3)
    expect(firstBody.limit).toBe(2)
    expect(firstBody.offset).toBe(0)
    expect(firstBody.items).toHaveLength(2)
    const second = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ limit: 2, offset: 2 })
      .set(t.authHeader(token))
    expect(second.status).toBe(200)
    const secondBody = second.body as unknown as { items: { id: string }[]; total: number }
    expect(secondBody.total).toBe(3)
    expect(secondBody.items).toHaveLength(1)
  })

  it('filters by ids CSV and returns only those assets with fileId', async () => {
    const user = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const fileA = await seedFile(t, user.id)
    const assetA = await seedAsset(t, user.id, fileA.id)
    const fileB = await seedFile(t, user.id)
    const assetB = await seedAsset(t, user.id, fileB.id)
    const otherFile = await seedFile(t, other.id)
    await seedAsset(t, other.id, otherFile.id)

    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ids: `${assetA.id},${assetB.id}` })
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { id: string; fileId: string }[]; total: number }
    expect(body.total).toBe(2)
    expect(body.items.map((i) => i.id).sort()).toEqual([assetA.id, assetB.id].sort())
    expect(body.items.find((i) => i.id === assetA.id)?.fileId).toBe(fileA.id)
  })

  it('rejects a malformed ids filter with 400', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ids: 'not-a-uuid' })
      .set(t.authHeader(token))
    expect(res.status).toBe(400)
  })

  it('returns all matched ids without an explicit limit', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const assetIds: string[] = []
    for (let i = 0; i < 22; i++) {
      const file = await seedFile(t, user.id)
      assetIds.push((await seedAsset(t, user.id, file.id)).id)
    }
    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ids: assetIds.join(',') })
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { id: string }[]; total: number }
    expect(body.total).toBe(22)
    expect(body.items).toHaveLength(22)
  })

  it('rejects more than 100 ids with 400', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const ids = Array.from({ length: 101 }, () => randomUUID()).join(',')
    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ids })
      .set(t.authHeader(token))
    expect(res.status).toBe(400)
  })
})
