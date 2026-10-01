import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { FaceDetectorKind } from '@photox/shared-types'
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

function envDefault(): FaceDetectorKind {
  return process.env.FACE_DETECTOR === 'scrfd' ? 'scrfd' : 'human'
}

describe('admin face reprocess and recluster', () => {
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

  async function adminAuth(): Promise<Record<string, string>> {
    const admin = await seedUser(t, { role: 'admin' })
    return t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role }))
  }

  async function seedPhotoAsset(userId: string, opts?: { isTrashed?: boolean }) {
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id, {
      kind: 'photo',
      isTrashed: opts?.isTrashed ?? false,
    })
    return { file, asset }
  }

  it('rejects unauthenticated requests', async () => {
    const reprocess = await request(apiServer(t)).post('/api/v1/admin/faces/reprocess')
    expect(reprocess.status).toBe(401)
    const status = await request(apiServer(t)).get('/api/v1/admin/faces/reprocess')
    expect(status.status).toBe(401)
    const recluster = await request(apiServer(t)).post('/api/v1/admin/faces/recluster')
    expect(recluster.status).toBe(401)
  })

  it('rejects non-admin requests', async () => {
    const user = await seedUser(t)
    const auth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }))
    const reprocess = await request(apiServer(t)).post('/api/v1/admin/faces/reprocess').set(auth)
    expect(reprocess.status).toBe(403)
    const status = await request(apiServer(t)).get('/api/v1/admin/faces/reprocess').set(auth)
    expect(status.status).toBe(403)
    const recluster = await request(apiServer(t)).post('/api/v1/admin/faces/recluster').set(auth)
    expect(recluster.status).toBe(403)
  })

  it('reports lastRun null and queue counts before any run', async () => {
    const auth = await adminAuth()
    const res = await request(apiServer(t)).get('/api/v1/admin/faces/reprocess').set(auth)
    expect(res.status).toBe(200)
    const body = res.body as { lastRun: unknown; queue: Record<string, number> }
    expect(body.lastRun).toBeNull()
    expect(typeof body.queue).toBe('object')
  })

  it('enqueues re-embed jobs for non-trashed photos and records the run', async () => {
    const auth = await adminAuth()
    const owner = await seedUser(t)
    const a = await seedPhotoAsset(owner.id)
    const b = await seedPhotoAsset(owner.id)
    const videoFile = await seedFile(t, owner.id, { mimeType: 'video/mp4' })
    await seedAsset(t, owner.id, videoFile.id, { kind: 'video' })
    const trashed = await seedPhotoAsset(owner.id, { isTrashed: true })

    const res = await request(apiServer(t)).post('/api/v1/admin/faces/reprocess').set(auth)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enqueued: 2, total: 2, detector: envDefault() })

    const queue = t.getQueue('process-faces')
    for (const { file, asset } of [a, b]) {
      const job = await queue.getJob(`face-reembed-${asset.id}`)
      expect(job).toBeTruthy()
      expect(job?.name).toBe('re-embed')
      expect(job?.opts.removeOnComplete).toBe(true)
      expect(job?.data as Record<string, unknown>).toMatchObject({
        assetId: asset.id,
        fileId: file.id,
        userId: owner.id,
        reason: 're-embed',
        detector: envDefault(),
      })
    }
    expect(await queue.getJob(`face-reembed-${trashed.asset.id}`)).toBeFalsy()

    const status = await request(apiServer(t)).get('/api/v1/admin/faces/reprocess').set(auth)
    expect(status.status).toBe(200)
    const body = status.body as {
      lastRun: { startedAt: string; total: number; enqueued: number; detector: string }
      queue: Record<string, number>
    }
    expect(body.lastRun.total).toBe(2)
    expect(body.lastRun.enqueued).toBe(2)
    expect(body.lastRun.detector).toBe(envDefault())
    expect(Number.isNaN(Date.parse(body.lastRun.startedAt))).toBe(false)
    expect(body.queue.waiting).toBeGreaterThanOrEqual(2)
  })

  it('re-enqueues the same asset after a completed job is removed', async () => {
    const auth = await adminAuth()
    const owner = await seedUser(t)
    const { asset } = await seedPhotoAsset(owner.id)
    const jobId = `face-reembed-${asset.id}`

    const first = await request(apiServer(t)).post('/api/v1/admin/faces/reprocess').set(auth)
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ enqueued: 1, total: 1, detector: envDefault() })

    const queue = t.getQueue('process-faces')
    const job = await queue.getJob(jobId)
    expect(job?.opts.removeOnComplete).toBe(true)
    await job?.remove()
    expect(await queue.getJob(jobId)).toBeFalsy()

    const second = await request(apiServer(t)).post('/api/v1/admin/faces/reprocess').set(auth)
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ enqueued: 1, total: 1, detector: envDefault() })
    expect(await queue.getJob(jobId)).toBeTruthy()
  })

  it('stamps the persisted detector on reprocess jobs', async () => {
    const auth = await adminAuth()
    const put = await request(apiServer(t))
      .put('/api/v1/admin/face-detection')
      .set(auth)
      .send({ detector: 'scrfd' })
    expect(put.status).toBe(200)

    const owner = await seedUser(t)
    const { file, asset } = await seedPhotoAsset(owner.id)
    const res = await request(apiServer(t)).post('/api/v1/admin/faces/reprocess').set(auth)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enqueued: 1, total: 1, detector: 'scrfd' })

    const job = await t.getQueue('process-faces').getJob(`face-reembed-${asset.id}`)
    expect(job?.data as Record<string, unknown>).toMatchObject({
      fileId: file.id,
      detector: 'scrfd',
      reason: 're-embed',
    })
  })

  it('enqueues one manual cluster job per distinct user with faces', async () => {
    const auth = await adminAuth()
    const u1 = await seedUser(t)
    const u2 = await seedUser(t)
    const faceRow = (userId: string) =>
      t.faceRepo.create({
        assetId: randomUUID(),
        userId,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: null,
        detector: null,
      })
    await t.faceRepo.save([faceRow(u1.id), faceRow(u1.id), faceRow(u2.id)])

    const res = await request(apiServer(t)).post('/api/v1/admin/faces/recluster').set(auth)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enqueued: 2 })

    const queue = t.getQueue('process-faces-cluster')
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'])
    const mine = jobs.filter((job) => {
      const data = job.data as { userId?: string; reason?: string }
      return data.reason === 'manual' && (data.userId === u1.id || data.userId === u2.id)
    })
    expect(mine).toHaveLength(2)
    expect(new Set(mine.map((job) => (job.data as { userId: string }).userId))).toEqual(
      new Set([u1.id, u2.id]),
    )
    expect(new Set(mine.map((job) => job.id)).size).toBe(2)
    for (const job of mine) {
      const userId = (job.data as { userId: string }).userId
      expect(job.id).toMatch(new RegExp(`^cluster-${userId}-admin-\\d+$`))
    }
  })
})
