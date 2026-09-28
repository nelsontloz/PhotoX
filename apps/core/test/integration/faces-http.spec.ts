import { randomUUID } from 'node:crypto'
import request from 'supertest'
import sharp from 'sharp'
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

const EMBEDDING_512 = Array.from({ length: 512 }, () => 0.1)

describe('faces HTTP', () => {
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

  async function seedFace(
    userId: string,
    opts?: {
      box?: { x: number; y: number; w: number; h: number }
      embedding?: number[]
      personId?: string | null
    },
  ) {
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    const face = await t.faceRepo.save(
      t.faceRepo.create({
        assetId: asset.id,
        userId,
        box: opts?.box ?? { x: 10, y: 10, w: 20, h: 20 },
        confidence: 0.9,
        embedding: opts?.embedding ?? [0.1, 0.2, 0.3],
        personId: opts?.personId ?? null,
      }),
    )
    return { asset, file, face }
  }

  async function seedRealImageFace(userId: string) {
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#804020' },
    })
      .jpeg()
      .toBuffer()
    const file = await seedFile(t, userId, {
      bytes,
      mimeType: 'image/jpeg',
      originalName: 'photo.jpg',
    })
    const asset = await seedAsset(t, userId, file.id)
    const face = await t.faceRepo.save(
      t.faceRepo.create({
        assetId: asset.id,
        userId,
        box: { x: 10, y: 10, w: 20, h: 20 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
      }),
    )
    return { asset, face }
  }

  it('registers faces for the owner and persists the JWT userId', async () => {
    const owner = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: owner.id, email: owner.email, role: owner.role })
    const file = await seedFile(t, owner.id)
    const asset = await seedAsset(t, owner.id, file.id)
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/faces`)
      .set(t.authHeader(token))
      .send({
        userId: other.id,
        faces: [{ box: { x: 1, y: 2, w: 10, h: 10 }, confidence: 0.9, embedding: EMBEDDING_512 }],
      })
    expect(res.status).toBe(201)
    expect((res.body as { count: number }).count).toBe(1)
    const rows = await t.faceRepo.find({ where: { assetId: asset.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.userId).toBe(owner.id)
    expect(rows[0]?.embedding).toHaveLength(512)
  })

  it('accepts an empty faces array', async () => {
    const owner = await seedUser(t)
    const token = t.signToken({ id: owner.id, email: owner.email, role: owner.role })
    const file = await seedFile(t, owner.id)
    const asset = await seedAsset(t, owner.id, file.id)
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/faces`)
      .set(t.authHeader(token))
      .send({ userId: owner.id, faces: [] })
    expect(res.status).toBe(201)
    expect((res.body as { count: number }).count).toBe(0)
    expect(await t.faceRepo.count()).toBe(0)
  })

  it('rejects an embedding with the wrong length', async () => {
    const owner = await seedUser(t)
    const token = t.signToken({ id: owner.id, email: owner.email, role: owner.role })
    const file = await seedFile(t, owner.id)
    const asset = await seedAsset(t, owner.id, file.id)
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/faces`)
      .set(t.authHeader(token))
      .send({
        userId: owner.id,
        faces: [{ box: { x: 1, y: 2, w: 10, h: 10 }, confidence: 0.9, embedding: [0.1, 0.2] }],
      })
    expect(res.status).toBe(400)
    expect(await t.faceRepo.count()).toBe(0)
  })

  it('404s registering faces on a cross-user asset without creating rows', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/faces`)
      .set(t.authHeader(tokenB))
      .send({
        userId: b.id,
        faces: [{ box: { x: 1, y: 2, w: 10, h: 10 }, confidence: 0.9, embedding: EMBEDDING_512 }],
      })
    expect(res.status).toBe(404)
    expect(await t.faceRepo.count()).toBe(0)
  })

  it('lists only own faces and omits embeddings by default', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const { asset } = await seedFace(a.id)
    await seedFace(b.id)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const res = await request(apiServer(t)).get('/api/v1/faces').set(t.authHeader(tokenA))
    expect(res.status).toBe(200)
    const body = res.body as { items: { assetId: string; embedding?: number[] }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.assetId).toBe(asset.id)
    expect(body.items[0]?.embedding).toBeUndefined()
  })

  it('includes embeddings when includeEmbeddings=true', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { face } = await seedFace(user.id)
    const res = await request(apiServer(t))
      .get('/api/v1/faces')
      .query({ includeEmbeddings: 'true' })
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as { items: { id: string; embedding: number[] }[] }
    expect(body.items[0]?.id).toBe(face.id)
    expect(body.items[0]?.embedding).toEqual([0.1, 0.2, 0.3])
  })

  it('assigns a face to a person and refreshes faceCount', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { face } = await seedFace(user.id)
    const person = await t.personRepo.save(
      t.personRepo.create({ userId: user.id, name: null, clusterLabel: 'c-1', faceCount: 0 }),
    )
    const res = await request(apiServer(t))
      .patch(`/api/v1/faces/${face.id}/person`)
      .set(t.authHeader(token))
      .send({ personId: person.id })
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean }).ok).toBe(true)
    expect((await t.faceRepo.findOneByOrFail({ id: face.id })).personId).toBe(person.id)
    expect((await t.personRepo.findOneByOrFail({ id: person.id })).faceCount).toBe(1)
  })

  it('unassigns a face and refreshes faceCount', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const person = await t.personRepo.save(
      t.personRepo.create({ userId: user.id, name: null, clusterLabel: 'c-1', faceCount: 1 }),
    )
    const { face } = await seedFace(user.id, { personId: person.id })
    const res = await request(apiServer(t))
      .patch(`/api/v1/faces/${face.id}/person`)
      .set(t.authHeader(token))
      .send({ personId: null })
    expect(res.status).toBe(200)
    expect((await t.faceRepo.findOneByOrFail({ id: face.id })).personId).toBeNull()
    expect((await t.personRepo.findOneByOrFail({ id: person.id })).faceCount).toBe(0)
  })

  it('404s assigning a cross-user face', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const { face } = await seedFace(a.id)
    const personB = await t.personRepo.save(
      t.personRepo.create({ userId: b.id, name: null, clusterLabel: 'c-b', faceCount: 0 }),
    )
    const res = await request(apiServer(t))
      .patch(`/api/v1/faces/${face.id}/person`)
      .set(t.authHeader(tokenB))
      .send({ personId: personB.id })
    expect(res.status).toBe(404)
    expect((await t.faceRepo.findOneByOrFail({ id: face.id })).personId).toBeNull()
  })

  it('returns a private jpeg face thumbnail', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { face } = await seedRealImageFace(user.id)
    const res = await request(apiServer(t))
      .get(`/api/v1/faces/${face.id}/thumb`)
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers['cache-control']).toContain('private')
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0)
    const meta = await sharp(res.body as Buffer).metadata()
    expect(meta.width).toBe(240)
    expect(meta.height).toBe(240)
  })

  it('clamps the thumb size to 32..600', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { face } = await seedRealImageFace(user.id)
    const small = await request(apiServer(t))
      .get(`/api/v1/faces/${face.id}/thumb`)
      .query({ size: 10 })
      .set(t.authHeader(token))
    expect(small.status).toBe(200)
    expect((await sharp(small.body as Buffer).metadata()).width).toBe(32)
    const large = await request(apiServer(t))
      .get(`/api/v1/faces/${face.id}/thumb`)
      .query({ size: 9999 })
      .set(t.authHeader(token))
    expect(large.status).toBe(200)
    expect((await sharp(large.body as Buffer).metadata()).width).toBe(600)
  })

  it('returns 401 for a thumb request without a token', async () => {
    const user = await seedUser(t)
    const { face } = await seedRealImageFace(user.id)
    const res = await request(apiServer(t)).get(`/api/v1/faces/${face.id}/thumb`)
    expect(res.status).toBe(401)
  })

  it('404s thumbnails for unknown or cross-user faces', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const { face } = await seedRealImageFace(a.id)
    const cross = await request(apiServer(t))
      .get(`/api/v1/faces/${face.id}/thumb`)
      .set(t.authHeader(tokenB))
    expect(cross.status).toBe(404)
    const unknown = await request(apiServer(t))
      .get(`/api/v1/faces/${randomUUID()}/thumb`)
      .set(t.authHeader(tokenB))
    expect(unknown.status).toBe(404)
  })

  it('includes confidence in the face list', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { face } = await seedFace(user.id)
    const res = await request(apiServer(t)).get('/api/v1/faces').set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as { items: { id: string; confidence: number }[] }
    expect(body.items[0]?.id).toBe(face.id)
    expect(body.items[0]?.confidence).toBe(0.9)
  })

  it('excludeTrashed=true drops faces whose asset is soft-deleted', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const alive = await seedFace(user.id)
    const trashed = await seedFace(user.id)
    const trash = await request(apiServer(t))
      .post(`/api/v1/assets/${trashed.asset.id}/trash`)
      .set(t.authHeader(token))
    expect(trash.status).toBe(204)

    const all = await request(apiServer(t)).get('/api/v1/faces').set(t.authHeader(token))
    expect((all.body as { items: unknown[] }).items).toHaveLength(2)

    const filtered = await request(apiServer(t))
      .get('/api/v1/faces')
      .query({ excludeTrashed: 'true' })
      .set(t.authHeader(token))
    expect(filtered.status).toBe(200)
    const items = (filtered.body as { items: { assetId: string }[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.assetId).toBe(alive.asset.id)
  })

  it('deletes all faces for an asset, nulls dangling cover and refreshes faceCount', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const person = await t.personRepo.save(
      t.personRepo.create({ userId: user.id, name: null, clusterLabel: 'c-del', faceCount: 2 }),
    )
    const { asset, face: cover } = await seedFace(user.id, { personId: person.id })
    await t.faceRepo.save(
      t.faceRepo.create({
        assetId: asset.id,
        userId: user.id,
        box: { x: 5, y: 5, w: 10, h: 10 },
        confidence: 0.8,
        embedding: [0.4, 0.5, 0.6],
        personId: person.id,
      }),
    )
    await t.personRepo.update(person.id, { coverFaceId: cover.id })

    const res = await request(apiServer(t))
      .delete(`/api/v1/assets/${asset.id}/faces`)
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    expect((res.body as { deleted: number }).deleted).toBe(2)
    expect(await t.faceRepo.count()).toBe(0)
    const updated = await t.personRepo.findOneByOrFail({ id: person.id })
    expect(updated.coverFaceId).toBeNull()
    expect(updated.faceCount).toBe(0)

    const again = await request(apiServer(t))
      .delete(`/api/v1/assets/${asset.id}/faces`)
      .set(t.authHeader(token))
    expect(again.status).toBe(200)
    expect((again.body as { deleted: number }).deleted).toBe(0)
  })

  it('404s face deletion on cross-user or unknown assets without deleting rows', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const { asset, face } = await seedFace(a.id)
    const cross = await request(apiServer(t))
      .delete(`/api/v1/assets/${asset.id}/faces`)
      .set(t.authHeader(tokenB))
    expect(cross.status).toBe(404)
    const unknown = await request(apiServer(t))
      .delete(`/api/v1/assets/${randomUUID()}/faces`)
      .set(t.authHeader(tokenB))
    expect(unknown.status).toBe(404)
    expect(await t.faceRepo.count({ where: { id: face.id } })).toBe(1)
  })
})
