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

describe('thumbnails and trash JWT identity', () => {
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

  it('lists thumbnails without userId and ignores query userId', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        size: 'sm',
        fileId: randomUUID(),
        width: 10,
        height: 10,
        bytes: 5,
      }),
    )
    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/thumbnails`)
      .query({ userId: b.id })
      .set(t.authHeader(tokenA))
    expect(res.status).toBe(200)
  })

  it('rejects cross-user thumbnail access', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/thumbnails`)
      .set(t.authHeader(tokenB))
    expect(res.status).toBe(404)
  })

  it('rejects cross-user thumbnail register and keeps owner writes working', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const thumbFileId = randomUUID()
    const body = { size: 'sm', fileId: thumbFileId, width: 10, height: 10, bytes: 5 }

    const crossRegister = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/thumbnails`)
      .set(t.authHeader(tokenB))
      .send(body)
    expect(crossRegister.status).toBe(404)
    expect(await t.thumbRepo.findOne({ where: { assetId: asset.id, size: 'sm' } })).toBeNull()

    const ownRegister = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/thumbnails`)
      .set(t.authHeader(tokenA))
      .send(body)
    expect(ownRegister.status).toBe(201)

    const crossOverwrite = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/thumbnails`)
      .set(t.authHeader(tokenB))
      .send({ ...body, fileId: randomUUID(), width: 99 })
    expect(crossOverwrite.status).toBe(404)
    const afterCross = await t.thumbRepo.findOneOrFail({
      where: { assetId: asset.id, size: 'sm' },
    })
    expect(afterCross.fileId).toBe(thumbFileId)
    expect(afterCross.width).toBe(10)
  })

  it('restores, deletes and empties trash without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const fileOne = await seedFile(t, user.id)
    const assetOne = await seedAsset(t, user.id, fileOne.id)
    await request(apiServer(t)).post(`/api/v1/assets/${assetOne.id}/trash`).set(t.authHeader(token))
    const restore = await request(apiServer(t))
      .post(`/api/v1/assets/trashed/${assetOne.id}/restore`)
      .set(t.authHeader(token))
    expect(restore.status).toBe(204)
    await request(apiServer(t)).post(`/api/v1/assets/${assetOne.id}/trash`).set(t.authHeader(token))
    const del = await request(apiServer(t))
      .delete(`/api/v1/assets/trashed/${assetOne.id}`)
      .set(t.authHeader(token))
    expect(del.status).toBe(200)
    const fileTwo = await seedFile(t, user.id)
    const assetTwo = await seedAsset(t, user.id, fileTwo.id)
    await request(apiServer(t)).post(`/api/v1/assets/${assetTwo.id}/trash`).set(t.authHeader(token))
    const empty = await request(apiServer(t))
      .delete('/api/v1/assets/trashed')
      .set(t.authHeader(token))
    expect(empty.status).toBe(200)
  })

  it('rejects cross-user restore', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id, { isTrashed: true })
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/trashed/${asset.id}/restore`)
      .query({ userId: a.id })
      .set(t.authHeader(tokenB))
    expect(res.status).toBe(404)
    const own = await request(apiServer(t))
      .post(`/api/v1/assets/trashed/${asset.id}/restore`)
      .set(t.authHeader(tokenA))
    expect(own.status).toBe(204)
  })

  it('returns 401 without token', async () => {
    const user = await seedUser(t)
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)
    const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/thumbnails`)
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed token', async () => {
    const res = await request(apiServer(t))
      .get('/api/v1/assets/trashed')
      .set({ Authorization: 'Bearer not-a-token' })
    expect(res.status).toBe(401)
  })

  it('permanently deletes a trashed asset and returns its file ids', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id, { isTrashed: true })
    const thumbFileId = randomUUID()
    await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        size: 'sm',
        fileId: thumbFileId,
        width: 10,
        height: 10,
        bytes: 5,
      }),
    )

    const res = await request(apiServer(t))
      .delete(`/api/v1/assets/trashed/${asset.id}`)
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { fileIds: string[] }
    expect(new Set(body.fileIds)).toEqual(new Set([file.id, thumbFileId]))
    expect(await t.assetRepo.findOne({ where: { id: asset.id } })).toBeNull()
    // core returns the ids only; nothing calls the worker's cleanup-asset queue from here
    const jobs = await t.getQueue('cleanup-asset').getJobs(['waiting', 'active', 'delayed'])
    expect(jobs).toHaveLength(0)
  })

  it('empties trash returning every file id', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const fileIds: string[] = []
    for (let i = 0; i < 2; i++) {
      const file = await seedFile(t, user.id)
      fileIds.push(file.id)
      const asset = await seedAsset(t, user.id, file.id, { isTrashed: true })
      const thumbFileId = randomUUID()
      fileIds.push(thumbFileId)
      await t.thumbRepo.save(
        t.thumbRepo.create({
          assetId: asset.id,
          size: 'sm',
          fileId: thumbFileId,
          width: 10,
          height: 10,
          bytes: 5,
        }),
      )
    }

    const res = await request(apiServer(t))
      .delete('/api/v1/assets/trashed')
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { fileIds: string[] }
    expect(new Set(body.fileIds)).toEqual(new Set(fileIds))
    expect(await t.assetRepo.count({ where: { isTrashed: true } })).toBe(0)
    // core returns the ids only; nothing calls the worker's cleanup-asset queue from here
    const jobs = await t.getQueue('cleanup-asset').getJobs(['waiting', 'active', 'delayed'])
    expect(jobs).toHaveLength(0)
  })
})
