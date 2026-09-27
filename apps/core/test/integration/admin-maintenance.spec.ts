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

describe('admin maintenance', () => {
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

  async function seedOrphans() {
    const admin = await seedUser(t, { role: 'admin' })
    const old = new Date(Date.now() - 60 * 60 * 1000)
    const staleRef = await seedFile(t, admin.id)
    await t.fileRepo.update(staleRef.id, { createdAt: old })
    const staleOrphan = await seedFile(t, admin.id)
    await t.fileRepo.update(staleOrphan.id, { createdAt: old })
    const fresh = await seedFile(t, admin.id)
    await t.fileRepo.update(fresh.id, { createdAt: new Date() })
    const asset = await seedAsset(t, admin.id, staleRef.id, { kind: 'photo' })
    const sm = await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        size: 'sm',
        fileId: randomUUID(),
        width: 10,
        height: 10,
        bytes: 5,
        createdAt: old,
      }),
    )
    await t.thumbRepo.update(sm.id, { createdAt: old })
    const md = await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        size: 'md',
        fileId: staleRef.id,
        width: 10,
        height: 10,
        bytes: 5,
        createdAt: old,
      }),
    )
    await t.thumbRepo.update(md.id, { createdAt: old })
    const lg = await t.thumbRepo.save(
      t.thumbRepo.create({
        assetId: asset.id,
        size: 'lg',
        fileId: randomUUID(),
        width: 10,
        height: 10,
        bytes: 5,
        createdAt: new Date(),
      }),
    )
    await t.thumbRepo.update(lg.id, { createdAt: new Date() })
    return { admin, asset, fresh }
  }

  it('returns exact orphan counts', async () => {
    const { admin } = await seedOrphans()
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const res = await request(apiServer(t))
      .get('/api/v1/admin/orphan-counts')
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { orphanFiles: number; orphanThumbnails: number }
    expect(body.orphanFiles).toBe(1)
    expect(body.orphanThumbnails).toBe(1)
  })

  it('enqueues cleanup-orphans', async () => {
    const { admin } = await seedOrphans()
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const res = await request(apiServer(t))
      .post('/api/v1/admin/cleanup-orphans')
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { enqueued: boolean }
    expect(body.enqueued).toBe(true)
    const queue = t.getQueue('cleanup-orphans')
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'])
    expect(jobs.length).toBeGreaterThan(0)
  })

  it('reprocesses photo thumbnails with thumb-reprocess jobIds', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const photoFile = await seedFile(t, admin.id)
    const photo = await seedAsset(t, admin.id, photoFile.id, { kind: 'photo' })
    const videoFile = await seedFile(t, admin.id, { mimeType: 'video/mp4' })
    await seedAsset(t, admin.id, videoFile.id, { kind: 'video' })
    const res = await request(apiServer(t))
      .post('/api/v1/admin/thumbnails/reprocess')
      .set(t.authHeader(token))
      .send({ kind: 'photo' })
    expect(res.status).toBe(200)
    const body = res.body as unknown as { enqueued: number; totalAssets: number }
    expect(body.totalAssets).toBe(1)
    expect(body.enqueued).toBe(4)
    const queue = t.getQueue('process-thumbnail')
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      const job = await queue.getJob(`thumb-reprocess-${photo.id}-${size}`)
      expect(job).toBeTruthy()
    }
  })

  it('rejects non-admin on admin endpoints', async () => {
    const user = await seedUser(t, { role: 'user' })
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const counts = await request(apiServer(t))
      .get('/api/v1/admin/orphan-counts')
      .set(t.authHeader(token))
    expect(counts.status).toBe(403)
    const cleanup = await request(apiServer(t))
      .post('/api/v1/admin/cleanup-orphans')
      .set(t.authHeader(token))
    expect(cleanup.status).toBe(403)
    const reprocess = await request(apiServer(t))
      .post('/api/v1/admin/thumbnails/reprocess')
      .set(t.authHeader(token))
      .send({ kind: 'photo' })
    expect(reprocess.status).toBe(403)
    const users = await request(apiServer(t)).get('/api/v1/admin/users').set(t.authHeader(token))
    expect(users.status).toBe(403)
    const assets = await request(apiServer(t))
      .get('/api/v1/admin/assets')
      .query({ kind: 'photo' })
      .set(t.authHeader(token))
    expect(assets.status).toBe(403)
  })

  it('lists users with pagination, q search, sort and role filter', async () => {
    const admin = await seedUser(t, { role: 'admin', email: 'alpha-admin@example.com' })
    await seedUser(t, { email: 'bravo-user@example.com' })
    await seedUser(t, { email: 'charlie-user@example.com' })
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const auth = t.authHeader(token)

    const page = await request(apiServer(t))
      .get('/api/v1/admin/users')
      .query({ limit: 2, offset: 1 })
      .set(auth)
    expect(page.status).toBe(200)
    const pageBody = page.body as unknown as {
      items: { assetCount: number; bytesUsed: number }[]
      total: number
      limit: number
      offset: number
    }
    expect(pageBody.total).toBe(3)
    expect(pageBody.items).toHaveLength(2)
    expect(pageBody.limit).toBe(2)
    expect(pageBody.offset).toBe(1)
    expect(pageBody.items[0]?.assetCount).toBe(0)
    expect(pageBody.items[0]?.bytesUsed).toBe(0)

    const search = await request(apiServer(t))
      .get('/api/v1/admin/users')
      .query({ q: 'bravo' })
      .set(auth)
    expect(search.status).toBe(200)
    const searchBody = search.body as unknown as { items: { email: string }[]; total: number }
    expect(searchBody.total).toBe(1)
    expect(searchBody.items[0]?.email).toBe('bravo-user@example.com')

    const sorted = await request(apiServer(t))
      .get('/api/v1/admin/users')
      .query({ sort: 'email:asc' })
      .set(auth)
    expect(sorted.status).toBe(200)
    const emails = (sorted.body as unknown as { items: { email: string }[] }).items.map(
      (i) => i.email,
    )
    expect(emails).toEqual([
      'alpha-admin@example.com',
      'bravo-user@example.com',
      'charlie-user@example.com',
    ])

    const admins = await request(apiServer(t))
      .get('/api/v1/admin/users')
      .query({ role: 'admin' })
      .set(auth)
    expect(admins.status).toBe(200)
    const adminsBody = admins.body as unknown as { items: { role: string }[]; total: number }
    expect(adminsBody.total).toBe(1)
    expect(adminsBody.items[0]?.role).toBe('admin')
  })

  it('rejects invalid user list queries', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const queries = [{ role: 'owner' }, { sort: 'email:sideways' }, { limit: 51 }, { offset: -1 }]
    for (const query of queries) {
      const res = await request(apiServer(t))
        .get('/api/v1/admin/users')
        .query(query)
        .set(t.authHeader(token))
      expect(res.status).toBe(400)
    }
  })

  it('counts assets per user via asset-stats', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const a = await seedUser(t)
    const b = await seedUser(t)
    const aOne = await seedFile(t, a.id)
    await seedAsset(t, a.id, aOne.id)
    const aTwo = await seedFile(t, a.id)
    await seedAsset(t, a.id, aTwo.id)
    const bOne = await seedFile(t, b.id)
    await seedAsset(t, b.id, bOne.id)
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })

    const res = await request(apiServer(t))
      .get('/api/v1/admin/users/asset-stats')
      .query({ userIds: `${a.id},${b.id}` })
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ [a.id]: 2, [b.id]: 1 })

    const none = await request(apiServer(t))
      .get('/api/v1/admin/users/asset-stats')
      .set(t.authHeader(token))
    expect(none.status).toBe(200)
    expect(none.body).toEqual({})
  })

  it('rejects more than 50 userIds on asset-stats', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const res = await request(apiServer(t))
      .get('/api/v1/admin/users/asset-stats')
      .query({ userIds: Array.from({ length: 51 }, () => randomUUID()).join(',') })
      .set(t.authHeader(token))
    expect(res.status).toBe(400)
  })

  it('sums storage bytes per user on files storage-stats', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const owner = await seedUser(t)
    await seedFile(t, owner.id, { bytes: Buffer.alloc(11) })
    await seedFile(t, owner.id, { bytes: Buffer.alloc(7) })
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })

    const res = await request(apiServer(t))
      .get('/api/v1/admin/files/storage-stats')
      .query({ userIds: owner.id })
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ [owner.id]: 18 })
  })

  it('rejects more than 50 userIds on storage-stats', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const res = await request(apiServer(t))
      .get('/api/v1/admin/files/storage-stats')
      .query({ userIds: Array.from({ length: 51 }, () => randomUUID()).join(',') })
      .set(t.authHeader(token))
    expect(res.status).toBe(400)
  })

  it('reports asset failure counts by kind', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const photoFile = await seedFile(t, admin.id)
    const photo = await seedAsset(t, admin.id, photoFile.id, { kind: 'photo' })
    await t.assetRepo.update(photo.id, { thumbnailStatus: 'failed' })
    const videoFile = await seedFile(t, admin.id, { mimeType: 'video/mp4' })
    const video = await seedAsset(t, admin.id, videoFile.id, { kind: 'video' })
    await t.assetRepo.update(video.id, { transcodeStatus: 'failed' })
    const trashedFile = await seedFile(t, admin.id)
    const trashed = await seedAsset(t, admin.id, trashedFile.id, { kind: 'photo', isTrashed: true })
    await t.assetRepo.update(trashed.id, { thumbnailStatus: 'failed' })

    const res = await request(apiServer(t))
      .get('/api/v1/admin/assets/counts')
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as {
      photos: { processing: number; metadata: number; thumbnails: number; encoding: number }
      videos: { processing: number; metadata: number; thumbnails: number; encoding: number }
    }
    expect(body.photos.thumbnails).toBe(1)
    expect(body.videos.encoding).toBe(1)
    expect(body.photos.processing).toBe(0)
    expect(body.videos.metadata).toBe(0)
  })

  it('lists assets for reprocess and requires a kind', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const photoFile = await seedFile(t, admin.id)
    const photo = await seedAsset(t, admin.id, photoFile.id, { kind: 'photo' })
    const videoFile = await seedFile(t, admin.id, { mimeType: 'video/mp4' })
    await seedAsset(t, admin.id, videoFile.id, { kind: 'video' })

    const missing = await request(apiServer(t)).get('/api/v1/admin/assets').set(t.authHeader(token))
    expect(missing.status).toBe(400)

    const res = await request(apiServer(t))
      .get('/api/v1/admin/assets')
      .query({ kind: 'photo' })
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as {
      items: { id: string; userId: string; fileId: string }[]
      total: number
    }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toEqual({ id: photo.id, userId: admin.id, fileId: photoFile.id })
  })
})
