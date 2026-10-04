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
const BODY = { text: 'passport number 12345', lang: 'eng', confidence: 0.92 }
const JOB_ID = (assetId: string) => `ocr-reprocess-${assetId}`

describe('asset OCR HTTP', () => {
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
    const res = await request(apiServer(t)).post(`/api/v1/assets/${asset.id}/ocr`).send(BODY)
    expect(res.status).toBe(401)
  })

  it('registers one trimmed OCR row for the asset owner', async () => {
    const { token, asset } = await seedOwnedAsset()
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/ocr`)
      .set(t.authHeader(token))
      .send({ ...BODY, text: '  passport number 12345  ' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true })

    const rows = await t.ocrRepo.find({ where: { assetId: asset.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toBe('passport number 12345')
    expect(rows[0]?.lang).toBe('eng')
    expect(rows[0]?.confidence).toBeCloseTo(0.92)
  })

  it('overwrites the single row on (assetId) instead of duplicating', async () => {
    const { token, asset } = await seedOwnedAsset()
    const post = (body: Record<string, unknown>) =>
      request(apiServer(t))
        .post(`/api/v1/assets/${asset.id}/ocr`)
        .set(t.authHeader(token))
        .send(body)
    expect((await post(BODY)).status).toBe(201)
    expect((await post({ text: 'second pass', lang: 'deu', confidence: 0.5 })).status).toBe(201)

    const rows = await t.ocrRepo.find({ where: { assetId: asset.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toBe('second pass')
    expect(rows[0]?.lang).toBe('deu')
  })

  it.each([
    ['empty text', { ...BODY, text: '' }],
    ['whitespace-only text', { ...BODY, text: '  \n\t ' }],
    ['oversized text', { ...BODY, text: 'x'.repeat(50_001) }],
    ['too-short lang', { ...BODY, lang: 'e' }],
    ['too-long lang', { ...BODY, lang: 'toolonglang' }],
    ['confidence above 1', { ...BODY, confidence: 1.5 }],
    ['confidence below 0', { ...BODY, confidence: -0.1 }],
  ])('422s %s without writing', async (_label, body) => {
    const { token, asset } = await seedOwnedAsset()
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/ocr`)
      .set(t.authHeader(token))
      .send(body)
    expect(res.status).toBe(422)
    expect(await t.ocrRepo.count()).toBe(0)
  })

  it('404s registering on a cross-user asset without writing', async () => {
    const { asset } = await seedOwnedAsset()
    const other = await seedUser(t)
    const token = t.signToken({ id: other.id, email: other.email, role: other.role })
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/ocr`)
      .set(t.authHeader(token))
      .send(BODY)
    expect(res.status).toBe(404)
    expect(await t.ocrRepo.count()).toBe(0)
  })

  it('accepts the worker delegated token as the asset owner', async () => {
    const { owner, asset } = await seedOwnedAsset()
    const token = t.signToken({ id: owner.id, email: owner.email, role: owner.role }, { act: true })
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/ocr`)
      .set(t.authHeader(token))
      .send(BODY)
    expect(res.status).toBe(201)
    expect(await t.ocrRepo.count()).toBe(1)
  })

  it('makes registered OCR rows searchable through the P3 FTS union', async () => {
    const { token, asset } = await seedOwnedAsset()
    const post = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/ocr`)
      .set(t.authHeader(token))
      .send({ text: 'passport number 12345', lang: 'eng', confidence: 0.9 })
    expect(post.status).toBe(201)

    const res = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'passport' })
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
      const anon = await request(apiServer(t)).post('/api/v1/admin/ocr/reprocess')
      expect(anon.status).toBe(401)
      const user = await seedUser(t)
      const auth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }))
      const res = await request(apiServer(t)).post('/api/v1/admin/ocr/reprocess').set(auth)
      expect(res.status).toBe(403)
    })

    it('enqueues OCR jobs for non-trashed photos, records the run and counts the queue', async () => {
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

      const before = await request(apiServer(t)).get('/api/v1/admin/ocr/reprocess').set(auth)
      expect(before.status).toBe(200)
      expect((before.body as { lastRun: unknown }).lastRun).toBeNull()

      const res = await request(apiServer(t)).post('/api/v1/admin/ocr/reprocess').set(auth)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ enqueued: 2, total: 2 })

      const queue = t.getQueue('process-ocr')
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

      const status = await request(apiServer(t)).get('/api/v1/admin/ocr/reprocess').set(auth)
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
