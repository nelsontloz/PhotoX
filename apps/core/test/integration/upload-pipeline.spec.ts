import request from 'supertest'
import sharp from 'sharp'
import { closeTestApp, createApiTestApp, resetDb, seedUser, apiServer } from './helpers'
import type { ApiTestApp } from './helpers'

async function pngBytes(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } })
    .png()
    .toBuffer()
}

async function waitForJobId(
  t: ApiTestApp,
  queueName: string,
  jobId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const start = Date.now()
  const queue = t.getQueue(queueName)
  while (Date.now() - start < timeoutMs) {
    const job = await queue.getJob(jobId)
    if (job) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

async function waitForJobWithAsset(
  t: ApiTestApp,
  queueName: string,
  assetId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const start = Date.now()
  const queue = t.getQueue(queueName)
  while (Date.now() - start < timeoutMs) {
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'])
    if (jobs.some((j) => (j.data as { assetId?: string }).assetId === assetId)) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

describe('upload pipeline', () => {
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

  it('uploads photo, creates rows and enqueues jobs', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const bytes = await pngBytes()
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', bytes, 'photo.png')
      .field('kind', 'photo')
    expect(res.status).toBe(201)
    const asset = res.body as unknown as { id: string; fileId: string; kind: string }
    expect(asset.kind).toBe('photo')
    const fileRow = await t.fileRepo.findOne({ where: { id: asset.fileId } })
    expect(fileRow).toBeTruthy()
    const assetRow = await t.assetRepo.findOne({ where: { id: asset.id } })
    expect(assetRow).toBeTruthy()
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      expect(await waitForJobId(t, 'process-thumbnail', `thumb-${asset.id}-${size}`)).toBe(true)
    }
    expect(await waitForJobWithAsset(t, 'process-metadata', asset.id)).toBe(true)
    expect(await waitForJobWithAsset(t, 'process-faces', asset.id)).toBe(true)
  })

  it('uploads video with any bytes and enqueues video job', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', Buffer.from('fake-video-bytes'), {
        filename: 'video.mp4',
        contentType: 'video/mp4',
      })
    expect(res.status).toBe(201)
    const asset = res.body as unknown as { id: string; kind: string }
    expect(asset.kind).toBe('video')
    expect(await waitForJobId(t, 'process-video', `video-${asset.id}`)).toBe(true)
  })

  it('rejects duplicates with 409 shape', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const bytes = await pngBytes()
    const first = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', bytes, 'dup.png')
    expect(first.status).toBe(201)
    const firstAsset = first.body as unknown as { id: string; fileId: string }
    const second = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', bytes, 'dup.png')
    expect(second.status).toBe(409)
    const body = second.body as unknown as { existingAssetId: string; existingFileId: string }
    expect(body.existingAssetId).toBe(firstAsset.id)
    expect(body.existingFileId).toBe(firstAsset.fileId)
  })

  it('rejects non-image/video mime with 400', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t))
      .post('/api/v1/files')
      .set(t.authHeader(token))
      .attach('file', Buffer.from('pdf-bytes'), { filename: 'doc.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(400)
  })
})
