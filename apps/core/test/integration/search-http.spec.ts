import request from 'supertest'
import { ServiceUnavailableException } from '@nestjs/common'
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

const unit = (axis: number): number[] =>
  Array.from({ length: SEARCH_EMBEDDING_DIM }, (_, i) => (i === axis ? 1 : 0))
const E0 = unit(0)
const E1 = unit(1)
const NEAR = Array.from({ length: SEARCH_EMBEDDING_DIM }, (_, i) =>
  i === 0 ? 0.8 : i === 1 ? 0.6 : 0,
)

describe('hybrid search HTTP', () => {
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

  it('requires a token', async () => {
    const res = await request(apiServer(t)).get('/api/v1/search').query({ q: 'red square' })
    expect(res.status).toBe(401)
  })

  it.each([
    ['a missing q', {}],
    ['a 201-char q', { q: 'x'.repeat(201) }],
    ['limit 0', { q: 'x', limit: '0' }],
    ['limit 101', { q: 'x', limit: '101' }],
    ['negative offset', { q: 'x', offset: '-1' }],
  ])('400s %s', async (_label, query) => {
    const { auth } = await ownerAuth()
    const res = await request(apiServer(t)).get('/api/v1/search').query(query).set(auth)
    expect(res.status).toBe(400)
  })

  it('ranks by ANN similarity and returns the list-assets item shape', async () => {
    const { userId, auth } = await ownerAuth()
    const a = await seedAssetWith(userId)
    const b = await seedAssetWith(userId)
    const c = await seedAssetWith(userId)
    await seedEmbedding(a.id, E0)
    await seedEmbedding(b.id, NEAR)
    await seedEmbedding(c.id, E1)

    const res = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'red square' })
      .set(auth)
    expect(res.status).toBe(200)
    const body = res.body as { items: Asset[]; total: number }
    expect(body.total).toBe(3)
    expect(body.items.map((i) => i.id)).toEqual([a.id, b.id, c.id])

    // identical serializer to GET /api/v1/assets
    const list = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ids: `${a.id},${b.id},${c.id}` })
      .set(auth)
    const listItem = (list.body as { items: Asset[] }).items.find((i) => i.id === a.id)
    expect(body.items[0]).toEqual(listItem)
  })

  it('matches titles and OCR text through FTS', async () => {
    const { userId, auth } = await ownerAuth()
    const titleAsset = await seedAssetWith(userId, { title: 'beach sunset over the ocean' })
    const ocrAsset = await seedAssetWith(userId)
    await t.ocrRepo.save(
      t.ocrRepo.create({
        assetId: ocrAsset.id,
        text: 'passport number 12345',
        lang: 'en',
        confidence: 0.9,
      }),
    )

    const byTitle = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'beach sunset' })
      .set(auth)
    expect(byTitle.status).toBe(200)
    expect((byTitle.body as { items: Asset[] }).items.map((i) => i.id)).toEqual([titleAsset.id])

    const byOcr = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'passport' })
      .set(auth)
    expect((byOcr.body as { items: Asset[] }).items.map((i) => i.id)).toEqual([ocrAsset.id])
  })

  it('excludes trashed and cross-user assets', async () => {
    const { userId, auth } = await ownerAuth()
    await seedAssetWith(userId, { title: 'beach sunset', isTrashed: true })
    const other = await seedUser(t)
    await seedAssetWith(other.id, { title: 'beach sunset' })

    const res = await request(apiServer(t)).get('/api/v1/search').query({ q: 'beach' }).set(auth)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], total: 0 })
  })

  it('surfaces person-name and place matches via the fusion bonus', async () => {
    const { userId, auth } = await ownerAuth()
    const personAsset = await seedAssetWith(userId)
    const person = await t.personRepo.save(
      t.personRepo.create({ userId, name: 'Sarah', clusterLabel: null, faceCount: 1 }),
    )
    await t.faceRepo.save(
      t.faceRepo.create({
        assetId: personAsset.id,
        userId,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: person.id,
        detector: null,
      }),
    )
    const placeAsset = await seedAssetWith(userId, { placeCity: 'Paris', placeCountryCode: 'FR' })

    const byPerson = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'sarah' })
      .set(auth)
    expect((byPerson.body as { items: Asset[] }).items.map((i) => i.id)).toEqual([personAsset.id])

    const byPlace = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'paris' })
      .set(auth)
    expect((byPlace.body as { items: Asset[] }).items.map((i) => i.id)).toEqual([placeAsset.id])
  })

  it('paginates after fusion', async () => {
    const { userId, auth } = await ownerAuth()
    const a = await seedAssetWith(userId)
    const b = await seedAssetWith(userId)
    const c = await seedAssetWith(userId)
    await seedEmbedding(a.id, E0)
    await seedEmbedding(b.id, NEAR)
    await seedEmbedding(c.id, E1)

    const page1 = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'red square', limit: '2', offset: '0' })
      .set(auth)
    expect(page1.status).toBe(200)
    expect((page1.body as { items: Asset[]; total: number }).total).toBe(3)
    expect((page1.body as { items: Asset[] }).items.map((i) => i.id)).toEqual([a.id, b.id])

    const page2 = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'red square', limit: '2', offset: '2' })
      .set(auth)
    expect((page2.body as { items: Asset[] }).items.map((i) => i.id)).toEqual([c.id])
  })

  it('503s when the text model is not provisioned', async () => {
    const { auth } = await ownerAuth()
    encodeMock.mockRejectedValueOnce(new ServiceUnavailableException('Vision search model missing'))
    const res = await request(apiServer(t))
      .get('/api/v1/search')
      .query({ q: 'red square' })
      .set(auth)
    expect(res.status).toBe(503)
  })
})
