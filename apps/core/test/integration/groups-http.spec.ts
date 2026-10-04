import request from 'supertest'
import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
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
const E1 = Array.from({ length: SEARCH_EMBEDDING_DIM }, (_, i) => (i === 1 ? 1 : 0))
const NEAR = Array.from({ length: SEARCH_EMBEDDING_DIM }, (_, i) =>
  i === 0 ? 0.8 : i === 1 ? 0.6 : 0,
)

describe('groups HTTP (duplicates / similar)', () => {
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

  async function ownerAuth(): Promise<{ userId: string; auth: Record<string, string> }> {
    const owner = await seedUser(t)
    return {
      userId: owner.id,
      auth: t.authHeader(t.signToken({ id: owner.id, email: owner.email, role: owner.role })),
    }
  }

  async function seedAssetWith(userId: string, fields: Partial<Asset> = {}): Promise<Asset> {
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    if (Object.keys(fields).length === 0) return asset
    await t.assetRepo.update(asset.id, fields as Record<string, unknown>)
    return t.assetRepo.findOneByOrFail({ id: asset.id })
  }

  async function seedEmbedding(assetId: string, embedding: number[]): Promise<void> {
    await t.embeddingRepo.save(
      t.embeddingRepo.create({ assetId, kind: 'image', model: SEARCH_EMBEDDING_MODEL, embedding }),
    )
  }

  it('requires a token on both endpoints', async () => {
    const { userId } = await ownerAuth()
    const asset = await seedAssetWith(userId)
    const dup = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/duplicates`)
    expect(dup.status).toBe(401)
    const sim = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/similar`)
    expect(sim.status).toBe(401)
  })

  describe('duplicates', () => {
    it('orders by Hamming distance, honours threshold and isolates owner/trashed/null-phash', async () => {
      const { userId, auth } = await ownerAuth()
      const source = await seedAssetWith(userId, { phash: '0000000000000000' })
      const near1 = await seedAssetWith(userId, { phash: '0000000000000001' })
      const near2 = await seedAssetWith(userId, { phash: '0000000000000003' })
      const far = await seedAssetWith(userId, { phash: 'ffffffffffffffff' })
      await seedAssetWith(userId, { phash: '0000000000000001', isTrashed: true })
      await seedAssetWith(userId) // NULL phash never matches
      const other = await seedUser(t)
      await seedAssetWith(other.id, { phash: '0000000000000001' })

      const res = await request(apiServer(t))
        .get(`/api/v1/assets/${source.id}/duplicates`)
        .set(auth)
      expect(res.status).toBe(200)
      const body = res.body as { items: Asset[]; total: number }
      expect(body.total).toBe(2)
      expect(body.items.map((i) => i.id)).toEqual([near1.id, near2.id])

      // same item shape as list-assets
      const list = await request(apiServer(t))
        .get('/api/v1/assets')
        .query({ ids: near1.id })
        .set(auth)
      expect(body.items[0]).toEqual((list.body as { items: Asset[] }).items[0])

      const wide = await request(apiServer(t))
        .get(`/api/v1/assets/${source.id}/duplicates`)
        .query({ threshold: '64' })
        .set(auth)
      expect((wide.body as { items: Asset[]; total: number }).total).toBe(3)
      expect((wide.body as { items: Asset[] }).items.map((i) => i.id)).toEqual([
        near1.id,
        near2.id,
        far.id,
      ])
    })

    it('returns an empty page when the source has no phash', async () => {
      const { userId, auth } = await ownerAuth()
      const source = await seedAssetWith(userId)
      const res = await request(apiServer(t))
        .get(`/api/v1/assets/${source.id}/duplicates`)
        .set(auth)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ items: [], total: 0 })
    })

    it('404s a cross-user or unknown source', async () => {
      const { userId } = await ownerAuth()
      const asset = await seedAssetWith(userId, { phash: '0000000000000000' })
      const other = await seedUser(t)
      const auth = t.authHeader(t.signToken({ id: other.id, email: other.email, role: other.role }))
      const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/duplicates`).set(auth)
      expect(res.status).toBe(404)
    })
  })

  describe('similar', () => {
    it('excludes self, ranks by embedding distance and skips assets without embeddings', async () => {
      const { userId, auth } = await ownerAuth()
      const source = await seedAssetWith(userId)
      const near = await seedAssetWith(userId)
      const far = await seedAssetWith(userId)
      await seedAssetWith(userId) // no embedding
      await seedEmbedding(source.id, E0)
      await seedEmbedding(near.id, NEAR)
      await seedEmbedding(far.id, E1)

      const res = await request(apiServer(t)).get(`/api/v1/assets/${source.id}/similar`).set(auth)
      expect(res.status).toBe(200)
      const body = res.body as { items: Asset[]; total: number }
      expect(body.total).toBe(2)
      expect(body.items.map((i) => i.id)).toEqual([near.id, far.id])

      const one = await request(apiServer(t))
        .get(`/api/v1/assets/${source.id}/similar`)
        .query({ limit: '1' })
        .set(auth)
      expect((one.body as { items: Asset[] }).items.map((i) => i.id)).toEqual([near.id])
    })

    it('returns an empty page when the source has no embedding', async () => {
      const { userId, auth } = await ownerAuth()
      const source = await seedAssetWith(userId)
      const res = await request(apiServer(t)).get(`/api/v1/assets/${source.id}/similar`).set(auth)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ items: [], total: 0 })
    })

    it('404s a cross-user source', async () => {
      const { userId } = await ownerAuth()
      const asset = await seedAssetWith(userId)
      const other = await seedUser(t)
      const auth = t.authHeader(t.signToken({ id: other.id, email: other.email, role: other.role }))
      const res = await request(apiServer(t)).get(`/api/v1/assets/${asset.id}/similar`).set(auth)
      expect(res.status).toBe(404)
    })
  })

  it('whitelists a 16-hex phash through PATCH metadata and 422s bad formats', async () => {
    const { userId, auth } = await ownerAuth()
    const asset = await seedAssetWith(userId)

    const ok = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(auth)
      .send({ phash: 'deadbeefdeadbeef' })
    expect(ok.status).toBe(200)
    expect((await t.assetRepo.findOneByOrFail({ id: asset.id })).phash).toBe('deadbeefdeadbeef')

    for (const bad of ['XYZ123', 'deadbeef', 'DEADBEEFDEADBEEF', 'zzzzzzzzzzzzzzzz']) {
      const res = await request(apiServer(t))
        .patch(`/api/v1/assets/${asset.id}/metadata`)
        .set(auth)
        .send({ phash: bad })
      expect(res.status).toBe(422)
    }
  })
})
