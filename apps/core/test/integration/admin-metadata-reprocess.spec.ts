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
import { adminAuthHarness, reprocessMatrix } from './helpers/reprocess-matrix'

const PHASH = '0123456789abcdef'

describe('admin metadata reprocess', () => {
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

  async function seedPhoto(userId: string, opts?: { phash?: string; isTrashed?: boolean }) {
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id, {
      kind: 'photo',
      isTrashed: opts?.isTrashed ?? false,
    })
    if (opts?.phash !== undefined) await t.assetRepo.update(asset.id, { phash: opts.phash })
    return { file, asset }
  }

  it('rejects unauthenticated and non-admin requests', async () => {
    await adminAuthHarness(t, {
      post: ['/api/v1/admin/metadata/reprocess'],
      get: ['/api/v1/admin/metadata/reprocess'],
    })
  })

  it('reports lastRun null and queue counts before any run', async () => {
    const auth = await adminAuth()
    const res = await request(apiServer(t)).get('/api/v1/admin/metadata/reprocess').set(auth)
    expect(res.status).toBe(200)
    const body = res.body as { lastRun: unknown; queue: Record<string, number> }
    expect(body.lastRun).toBeNull()
    expect(typeof body.queue).toBe('object')
  })

  it('enqueues only non-trashed photos missing a phash', async () => {
    const auth = await adminAuth()
    const owner = await seedUser(t)
    const missing = await seedPhoto(owner.id)
    const hashed = await seedPhoto(owner.id, { phash: PHASH })
    const trashed = await seedPhoto(owner.id, { isTrashed: true })
    const videoFile = await seedFile(t, owner.id, { mimeType: 'video/mp4' })
    const video = await seedAsset(t, owner.id, videoFile.id, { kind: 'video' })

    await reprocessMatrix(t, auth, owner.id, [missing], {
      route: '/api/v1/admin/metadata/reprocess',
      queue: 'process-metadata',
      jobIdFn: (id) => `metadata-reprocess-${id}`,
      jobName: 'process-metadata',
      jobDataExtra: { kind: 'photo' },
      respKeys: { enqueued: 1, total: 1 },
      filter: [hashed.asset.id, trashed.asset.id, video.id],
    })

    const queue = t.getQueue('process-metadata')
    const job = await queue.getJob(`metadata-reprocess-${missing.asset.id}`)
    expect(job?.opts.removeOnFail).toBe(true)
  })

  it('re-enqueues the same asset after a completed job is removed', async () => {
    const auth = await adminAuth()
    const owner = await seedUser(t)
    const { asset } = await seedPhoto(owner.id)
    const jobId = `metadata-reprocess-${asset.id}`

    const first = await request(apiServer(t)).post('/api/v1/admin/metadata/reprocess').set(auth)
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ enqueued: 1, total: 1 })

    const queue = t.getQueue('process-metadata')
    const job = await queue.getJob(jobId)
    await job?.remove()
    expect(await queue.getJob(jobId)).toBeFalsy()

    const second = await request(apiServer(t)).post('/api/v1/admin/metadata/reprocess').set(auth)
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ enqueued: 1, total: 1 })
    expect(await queue.getJob(jobId)).toBeTruthy()
  })
})
