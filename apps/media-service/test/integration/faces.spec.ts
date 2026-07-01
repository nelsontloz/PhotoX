import { type INestApplication } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { of } from 'rxjs'
import sharp from 'sharp'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const faceInput = (overrides?: {
  x?: number
  y?: number
  w?: number
  h?: number
  confidence?: number
  embedding?: number[]
}) => ({
  box: {
    x: overrides?.x ?? 10,
    y: overrides?.y ?? 10,
    w: overrides?.w ?? 50,
    h: overrides?.h ?? 50,
  },
  confidence: overrides?.confidence ?? 0.95,
  embedding: overrides?.embedding ?? [0.1, 0.2, 0.3],
})

describe('Faces — register & get', () => {
  it('registers a single face for an asset', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [faceInput()] })
      .expect(201)

    expect(res.body).toEqual({ count: 1 })
  })

  it('registers multiple faces at once', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [faceInput(), faceInput({ x: 100 }), faceInput({ y: 200 })] })
      .expect(201)

    expect(res.body).toEqual({ count: 3 })
  })

  it('registers an empty faces array', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [] })
      .expect(201)

    expect(res.body).toEqual({ count: 0 })
  })

  it('returns faces for an asset', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [faceInput()] })
      .expect(201)

    const res = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)

    const body = res.body as {
      faces: { id: string; assetId: string; box: object; confidence: number; personId: null }[]
    }
    const face0 = body.faces[0]!
    expect(body.faces).toHaveLength(1)
    expect(face0.assetId).toBe(asset.id)
    expect(face0.confidence).toBe(0.95)
    expect(face0.personId).toBeNull()
    expect(face0.box).toEqual({ x: 10, y: 10, w: 50, h: 50 })
  })

  it('returns empty faces for asset with no faces', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)

    expect(res.body).toEqual({ faces: [] })
  })
})

describe('Faces — list for user', () => {
  it("returns only the requesting user's faces", async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const assetA = await createAssetForUser(httpServer, userA)
    const assetB = await createAssetForUser(httpServer, userB)

    await supertest(httpServer)
      .post(`/v1/assets/${assetA.id}/faces`)
      .send({ userId: userA, faces: [faceInput()] })
      .expect(201)

    await supertest(httpServer)
      .post(`/v1/assets/${assetB.id}/faces`)
      .send({ userId: userB, faces: [faceInput({ x: 200 })] })
      .expect(201)

    const res = await supertest(httpServer).get('/v1/faces').query({ userId: userA }).expect(200)

    const body = res.body as { items: { assetId: string }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]!.assetId).toBe(assetA.id)
  })

  it('includes embeddings when requested', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [faceInput({ embedding: [0.1, 0.2, 0.3] })] })
      .expect(201)

    const res = await supertest(httpServer)
      .get('/v1/faces')
      .query({ userId, includeEmbeddings: 'true' })
      .expect(200)

    const body = res.body as { items: { embedding?: number[] }[] }
    expect(body.items[0]!.embedding).toEqual([0.1, 0.2, 0.3])
  })

  it('omits embeddings by default', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [faceInput()] })
      .expect(201)

    const res = await supertest(httpServer).get('/v1/faces').query({ userId }).expect(200)

    const body = res.body as { items: { embedding?: number[] }[] }
    expect(body.items[0]!.embedding).toBeUndefined()
  })
})

describe('Faces — assign / unassign person', () => {
  it('assigns a person to a face', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [faceInput()] })
      .expect(201)

    const facesRes = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)
    const faceId = (facesRes.body as { faces: { id: string }[] }).faces[0]!.id

    const personRes = await supertest(httpServer)
      .post('/v1/persons')
      .send({ userId, clusterLabel: 'cluster-1' })
      .expect(201)
    const personId = (personRes.body as { id: string }).id

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId, personId })
      .expect(200)

    const verify = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)
    const face = (verify.body as { faces: { id: string; personId: string | null }[] }).faces[0]!
    expect(face.personId).toBe(personId)
  })

  it('unassigns a person from a face', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [faceInput()] })
      .expect(201)

    const facesRes = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)
    const faceId = (facesRes.body as { faces: { id: string }[] }).faces[0]!.id

    const personRes = await supertest(httpServer)
      .post('/v1/persons')
      .send({ userId, clusterLabel: 'c' })
      .expect(201)
    const personId = (personRes.body as { id: string }).id

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId, personId })
      .expect(200)

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId, personId: null })
      .expect(200)

    const verify = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)
    const face = (verify.body as { faces: { personId: string | null }[] }).faces[0]!
    expect(face.personId).toBeNull()
  })

  it('returns 404 for non-existent face', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .patch('/v1/faces/00000000-0000-0000-0000-000000000000/person')
      .send({ userId, personId: null })
      .expect(404)
  })

  it("returns 404 when assigning another user's face", async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const asset = await createAssetForUser(httpServer, userA)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId: userA, faces: [faceInput()] })
      .expect(201)

    const facesRes = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)
    const faceId = (facesRes.body as { faces: { id: string }[] }).faces[0]!.id

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId: userB, personId: null })
      .expect(404)
  })
})

describe('Faces — validation', () => {
  it('returns 400 when userId is missing', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ faces: [faceInput()] })
      .expect(400)
  })

  it('returns 400 when faces is not an array', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: 'not-array' })
      .expect(400)
  })

  it('returns 400 when box is missing', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [{ confidence: 0.9, embedding: [0.1] }] })
      .expect(400)
  })

  it('returns 400 when embedding is empty (ArrayMinSize(1))', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({
        userId,
        faces: [{ box: { x: 0, y: 0, w: 10, h: 10 }, confidence: 0.9, embedding: [] }],
      })
      .expect(400)
  })
})

describe('Faces — thumbnail', () => {
  it('returns a JPEG thumbnail for a face', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    const httpService = app.get(HttpService)
    const testImage = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer()
    vi.spyOn(httpService, 'get').mockReturnValue(of({ data: testImage.buffer }) as never)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId, faces: [faceInput({ x: 50, y: 50, w: 100, h: 100 })] })
      .expect(201)

    const facesRes = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)
    const faceId = (facesRes.body as { faces: { id: string }[] }).faces[0]!.id

    const res = await supertest(httpServer)
      .get(`/v1/faces/${faceId}/thumb`)
      .query({ userId })
      .expect(200)

    expect(res.headers['content-type']).toContain('image/jpeg')
    expect((res.body as Buffer).length).toBeGreaterThan(0)
  })

  it('returns 404 for non-existent face', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .get('/v1/faces/00000000-0000-0000-0000-000000000000/thumb')
      .query({ userId })
      .expect(404)
  })

  it("returns 404 for another user's face", async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const asset = await createAssetForUser(httpServer, userA)

    const httpService = app.get(HttpService)
    const testImage = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer()
    vi.spyOn(httpService, 'get').mockReturnValue(of({ data: testImage.buffer }) as never)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/faces`)
      .send({ userId: userA, faces: [faceInput({ x: 50, y: 50, w: 100, h: 100 })] })
      .expect(201)

    const facesRes = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)
    const faceId = (facesRes.body as { faces: { id: string }[] }).faces[0]!.id

    await supertest(httpServer)
      .get(`/v1/faces/${faceId}/thumb`)
      .query({ userId: userB })
      .expect(404)
  })
})
