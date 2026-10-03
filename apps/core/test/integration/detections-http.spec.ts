import request from 'supertest'
import { SEARCH_EMBEDDING_DIM } from '@photox/shared-types'
import type { Asset } from '../../src/database/entities'
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
} from './helpers'
import type { ApiTestApp } from './helpers'

const E0 = Array.from({ length: SEARCH_EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0))
const DETECTIONS = {
  detections: [
    { label: 'person', confidence: 0.9, box: { x: 10, y: 20, w: 30, h: 40 } },
    { label: 'laptop', confidence: 0.6, box: { x: 50, y: 60, w: 70, h: 80 } },
  ],
}
const JOB_ID = (assetId: string) => `detect-reprocess-${assetId}`

describe('asset detections HTTP', () => {
  let t: ApiTestApp
  const encodeMock = vi.fn((): Promise<number[]> => Promise.resolve(E0))

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null, encodeQuery: encodeMock })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
    encodeMock.mockReset()
    encodeMock.mockResolvedValue(E0)
  })

  async function seedOwnedAsset() {
    const owner = await seedUser(t)
    const token = t.signToken({ id: owner.id, email: owner.email, role: owner.role })
    const file = await seedFile(t, owner.id)
    const asset = await seedAsset(t, owner.id, file.id)
    return { owner, token, file, asset }
  }

  it('requires a token', async () => {
    const { asset } = await seedOwnedAsset()
    const post = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/detections`)
      .send(DETECTIONS)
    expect(post.status).toBe(401)
    const get = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/detections`)
    expect(get.status).toBe(401)
  })

  it('registers detections and returns them ordered by confidence desc', async () => {
    const { token, asset } = await seedOwnedAsset()
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
      .send(DETECTIONS)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true })

    const get = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
    expect(get.status).toBe(200)
    expect(get.body).toEqual(DETECTIONS)
    expect(await t.detectionRepo.count()).toBe(2)
  })

  it('replaces the row set instead of appending', async () => {
    const { token, asset } = await seedOwnedAsset()
    const post = (body: Record<string, unknown>) =>
      request(apiServer(t))
        .post(`/api/v1/assets/${asset.id}/detections`)
        .set(t.authHeader(token))
        .send(body)
    expect((await post(DETECTIONS)).status).toBe(201)
    expect(
      (
        await post({
          detections: [{ label: 'dog', confidence: 0.8, box: { x: 1, y: 2, w: 3, h: 4 } }],
        })
      ).status,
    ).toBe(201)

    const get = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
    expect((get.body as { detections: { label: string }[] }).detections).toEqual([
      { label: 'dog', confidence: 0.8, box: { x: 1, y: 2, w: 3, h: 4 } },
    ])
    expect(await t.detectionRepo.count()).toBe(1)
  })

  it('clears stale rows when the new set is empty', async () => {
    const { token, asset } = await seedOwnedAsset()
    await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
      .send(DETECTIONS)
    const clear = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
      .send({ detections: [] })
    expect(clear.status).toBe(201)

    const get = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
    expect(get.body).toEqual({ detections: [] })
    expect(await t.detectionRepo.count()).toBe(0)
  })

  it.each([
    [
      'more than 200 detections',
      {
        detections: Array.from({ length: 201 }, () => ({
          label: 'person',
          confidence: 0.9,
          box: { x: 1, y: 1, w: 10, h: 10 },
        })),
      },
    ],
    [
      'an empty label',
      { detections: [{ label: '', confidence: 0.9, box: { x: 1, y: 1, w: 10, h: 10 } }] },
    ],
    [
      'an oversized label',
      {
        detections: [{ label: 'x'.repeat(65), confidence: 0.9, box: { x: 1, y: 1, w: 10, h: 10 } }],
      },
    ],
    [
      'confidence above 1',
      { detections: [{ label: 'car', confidence: 1.5, box: { x: 1, y: 1, w: 10, h: 10 } }] },
    ],
    [
      'a zero-width box',
      { detections: [{ label: 'car', confidence: 0.5, box: { x: 1, y: 1, w: 0, h: 10 } }] },
    ],
    [
      'a negative-height box',
      { detections: [{ label: 'car', confidence: 0.5, box: { x: 1, y: 1, w: 10, h: -1 } }] },
    ],
  ])('422s %s without writing', async (_label, body) => {
    const { token, asset } = await seedOwnedAsset()
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
      .send(body)
    expect(res.status).toBe(422)
    expect(await t.detectionRepo.count()).toBe(0)
  })

  it('404s cross-user register and list without writing', async () => {
    const { asset } = await seedOwnedAsset()
    const other = await seedUser(t)
    const token = t.signToken({ id: other.id, email: other.email, role: other.role })
    const post = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
      .send(DETECTIONS)
    expect(post.status).toBe(404)
    const get = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
    expect(get.status).toBe(404)
    expect(await t.detectionRepo.count()).toBe(0)
  })

  it('accepts the worker delegated token as the asset owner', async () => {
    const { owner, asset } = await seedOwnedAsset()
    const token = t.signToken({ id: owner.id, email: owner.email, role: owner.role }, { act: true })
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
      .send(DETECTIONS)
    expect(res.status).toBe(201)
    expect(await t.detectionRepo.count()).toBe(2)
  })

  it('makes registered labels searchable through the P3 FTS union', async () => {
    const { token, asset } = await seedOwnedAsset()
    await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/detections`)
      .set(t.authHeader(token))
      .send(DETECTIONS)

    const res = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'laptop' })
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as { items: Asset[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items.map((i) => i.id)).toEqual([asset.id])
  })

  describe('admin reprocess', () => {
    async function adminAuth(): Promise<Record<string, string>> {
      const admin = await seedUser(t, { role: 'admin' })
      return t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role }))
    }

    it('rejects unauthenticated and non-admin requests', async () => {
      const anon = await request(apiServer(t)).post('/api/v1/admin/detections/reprocess')
      expect(anon.status).toBe(401)
      const user = await seedUser(t)
      const auth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }))
      const res = await request(apiServer(t)).post('/api/v1/admin/detections/reprocess').set(auth)
      expect(res.status).toBe(403)
    })

    it('enqueues detection jobs for non-trashed photos, records the run and counts the queue', async () => {
      const auth = await adminAuth()
      const owner = await seedUser(t)
      const photo = async (isTrashed = false) => {
        const file = await seedFile(t, owner.id)
        const asset = await seedAsset(t, owner.id, file.id, { kind: 'photo', isTrashed })
        return { file, asset }
      }
      const a = await photo()
      const b = await photo()
      const trashed = await photo(true)
      const videoFile = await seedFile(t, owner.id, { mimeType: 'video/mp4' })
      await seedAsset(t, owner.id, videoFile.id, { kind: 'video' })

      const before = await request(apiServer(t)).get('/api/v1/admin/detections/reprocess').set(auth)
      expect(before.status).toBe(200)
      expect((before.body as { lastRun: unknown }).lastRun).toBeNull()

      const res = await request(apiServer(t)).post('/api/v1/admin/detections/reprocess').set(auth)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ enqueued: 2, total: 2 })

      const queue = t.getQueue('process-detect')
      for (const { file, asset } of [a, b]) {
        const job = await queue.getJob(JOB_ID(asset.id))
        expect(job).toBeTruthy()
        expect(job?.opts.removeOnComplete).toBe(true)
        expect(job?.data as Record<string, unknown>).toMatchObject({
          assetId: asset.id,
          fileId: file.id,
          userId: owner.id,
        })
      }
      expect(await queue.getJob(JOB_ID(trashed.asset.id))).toBeFalsy()

      const status = await request(apiServer(t)).get('/api/v1/admin/detections/reprocess').set(auth)
      expect(status.status).toBe(200)
      const body = status.body as {
        lastRun: { startedAt: string; total: number; enqueued: number }
        queue: Record<string, number>
      }
      expect(body.lastRun.total).toBe(2)
      expect(body.lastRun.enqueued).toBe(2)
      expect(Number.isNaN(Date.parse(body.lastRun.startedAt))).toBe(false)
      expect(body.queue.waiting).toBeGreaterThanOrEqual(2)
    })
  })
})
