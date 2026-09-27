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

  it('rejects non-admin on all three', async () => {
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
  })
})
