import request from 'supertest'
import { SEARCH_EMBEDDING_DIM } from '@photox/shared-types'
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
import { seedSidecarAsset, sidecarHarness } from './helpers/sidecar'
import { adminAuthHarness, reprocessMatrix } from './helpers/reprocess-matrix'

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
    return seedSidecarAsset(t)
  }

  it('requires a token', async () => {
    await sidecarHarness(t, {
      route: (id) => `/worker/assets/${id}/ocr`,
      body: BODY,
      repo: t.ocrRepo,
    })
  })

  it('registers one trimmed OCR row for the asset owner', async () => {
    const { act, asset } = await seedOwnedAsset()
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/ocr`)
      .set(t.authHeader(act))
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
    const { act, asset } = await seedOwnedAsset()
    const post = (body: Record<string, unknown>) =>
      request(apiServer(t)).post(`/worker/assets/${asset.id}/ocr`).set(t.authHeader(act)).send(body)
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
    const { act, asset } = await seedOwnedAsset()
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/ocr`)
      .set(t.authHeader(act))
      .send(body)
    expect(res.status).toBe(422)
    expect(await t.ocrRepo.count()).toBe(0)
  })

  it('404s registering on a cross-user asset without writing', async () => {
    const { asset } = await seedOwnedAsset()
    const other = await seedUser(t)
    const act = t.signToken({ id: other.id, email: other.email, role: other.role }, { act: true })
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/ocr`)
      .set(t.authHeader(act))
      .send(BODY)
    expect(res.status).toBe(404)
    expect(await t.ocrRepo.count()).toBe(0)
  })

  it('accepts the worker delegated token as the asset owner', async () => {
    const { owner, asset } = await seedOwnedAsset()
    const act = t.signToken({ id: owner.id, email: owner.email, role: owner.role }, { act: true })
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/ocr`)
      .set(t.authHeader(act))
      .send(BODY)
    expect(res.status).toBe(201)
    expect(await t.ocrRepo.count()).toBe(1)
  })

  describe('admin reprocess', () => {
    async function adminAuth(): Promise<Record<string, string>> {
      const admin = await seedUser(t, { role: 'admin' })
      return t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role }))
    }

    it('rejects unauthenticated and non-admin requests', async () => {
      await adminAuthHarness(t, {
        post: ['/api/v1/admin/ocr/reprocess'],
        get: ['/api/v1/admin/ocr/reprocess'],
      })
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

      await reprocessMatrix(t, auth, owner.id, [a, b], {
        route: '/api/v1/admin/ocr/reprocess',
        queue: 'process-ocr',
        jobIdFn: JOB_ID,
        jobName: 'ocr',
        jobDataExtra: { reason: 'reprocess' },
        respKeys: { enqueued: 2, total: 2 },
        filter: [trashed.asset.id],
      })
    })
  })
})
