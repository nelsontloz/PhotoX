import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'

interface ErrorBody {
  message: string | string[]
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

const faceInput = (overrides?: { x?: number; y?: number; w?: number; h?: number }) => ({
  box: {
    x: overrides?.x ?? 10,
    y: overrides?.y ?? 10,
    w: overrides?.w ?? 50,
    h: overrides?.h ?? 50,
  },
  confidence: 0.95,
  embedding: [0.1, 0.2, 0.3],
})

async function createPerson(userId: string, label = 'cluster-1'): Promise<string> {
  const res = await supertest(httpServer)
    .post('/v1/persons')
    .send({ userId, clusterLabel: label })
    .expect(201)
  return (res.body as { id: string }).id
}

async function registerFaceForAsset(userId: string, assetId: string): Promise<string> {
  await supertest(httpServer)
    .post(`/v1/assets/${assetId}/faces`)
    .send({ userId, faces: [faceInput()] })
    .expect(201)

  const facesRes = await supertest(httpServer).get(`/v1/assets/${assetId}/faces`).expect(200)
  return (facesRes.body as { faces: { id: string }[] }).faces[0]!.id
}

describe('Persons — create', () => {
  it('creates a person and returns its id', async () => {
    const userId = mintUserId()
    const id = await createPerson(userId)
    expect(typeof id).toBe('string')
  })

  it('returns 400 when clusterLabel is missing', async () => {
    const userId = mintUserId()
    await supertest(httpServer).post('/v1/persons').send({ userId }).expect(400)
  })

  it('returns 400 when clusterLabel exceeds 200 chars', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .post('/v1/persons')
      .send({ userId, clusterLabel: 'x'.repeat(201) })
      .expect(400)
  })

  it('returns 400 when userId is missing', async () => {
    await supertest(httpServer).post('/v1/persons').send({ clusterLabel: 'cluster-1' }).expect(400)
  })
})

describe('Persons — list', () => {
  it('lists persons for a user', async () => {
    const userId = mintUserId()
    await createPerson(userId, 'a')
    await createPerson(userId, 'b')

    const res = await supertest(httpServer).get('/v1/persons').query({ userId }).expect(200)

    const body = res.body as {
      items: { id: string }[]
      total: number
      limit: number
      offset: number
    }
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(2)
  })

  it('paginates results', async () => {
    const userId = mintUserId()
    await createPerson(userId, 'a')
    await createPerson(userId, 'b')
    await createPerson(userId, 'c')

    const res = await supertest(httpServer)
      .get('/v1/persons')
      .query({ userId, limit: 2, offset: 0 })
      .expect(200)

    const body = res.body as { items: { id: string }[]; total: number }
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(3)
  })

  it('returns empty for user with no persons', async () => {
    const userId = mintUserId()
    const res = await supertest(httpServer).get('/v1/persons').query({ userId }).expect(200)

    const body = res.body as { items: { id: string }[]; total: number }
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })
})

describe('Persons — get one', () => {
  it('returns a person by id', async () => {
    const userId = mintUserId()
    const id = await createPerson(userId)

    const res = await supertest(httpServer).get(`/v1/persons/${id}`).query({ userId }).expect(200)

    const body = res.body as {
      id: string
      userId: string
      name: null
      coverFaceId: null
      clusterLabel: string
      faceCount: number
    }
    expect(body.id).toBe(id)
    expect(body.userId).toBe(userId)
    expect(body.name).toBeNull()
    expect(body.coverFaceId).toBeNull()
    expect(body.clusterLabel).toBe('cluster-1')
    expect(body.faceCount).toBe(0)
  })

  it('returns 404 for non-existent person', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .get('/v1/persons/00000000-0000-0000-0000-000000000000')
      .query({ userId })
      .expect(404)
  })
})

describe('Persons — update (rename)', () => {
  it('renames a person', async () => {
    const userId = mintUserId()
    const id = await createPerson(userId)

    const res = await supertest(httpServer)
      .patch(`/v1/persons/${id}`)
      .query({ userId })
      .send({ name: 'Alice' })
      .expect(200)

    const body = res.body as { id: string; name: string }
    expect(body.id).toBe(id)
    expect(body.name).toBe('Alice')
  })

  it('returns 404 for non-existent person', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .patch('/v1/persons/00000000-0000-0000-0000-000000000000')
      .query({ userId })
      .send({ name: 'X' })
      .expect(404)
  })
})

describe('Persons — set cover', () => {
  it('sets a cover face on a person', async () => {
    const userId = mintUserId()
    const personId = await createPerson(userId)
    const asset = await createAssetForUser(httpServer, userId)
    const faceId = await registerFaceForAsset(userId, asset.id)

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId, personId })
      .expect(200)

    const res = await supertest(httpServer)
      .patch(`/v1/persons/${personId}/cover`)
      .send({ userId, faceId })
      .expect(200)

    expect(res.body).toEqual({ ok: true })
  })

  it('returns 403 when face belongs to another person', async () => {
    const userId = mintUserId()
    const personA = await createPerson(userId, 'a')
    const personB = await createPerson(userId, 'b')
    const asset = await createAssetForUser(httpServer, userId)
    const faceId = await registerFaceForAsset(userId, asset.id)

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId, personId: personA })
      .expect(200)

    await supertest(httpServer)
      .patch(`/v1/persons/${personB}/cover`)
      .send({ userId, faceId })
      .expect(403)
  })

  it('returns 404 for non-existent person', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    const faceId = await registerFaceForAsset(userId, asset.id)

    await supertest(httpServer)
      .patch('/v1/persons/00000000-0000-0000-0000-000000000000/cover')
      .send({ userId, faceId })
      .expect(404)
  })
})

describe('Persons — reassign faces', () => {
  it('moves faces from one person to another', async () => {
    const userId = mintUserId()
    const personA = await createPerson(userId, 'a')
    const personB = await createPerson(userId, 'b')
    const asset = await createAssetForUser(httpServer, userId)
    const faceId = await registerFaceForAsset(userId, asset.id)

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId, personId: personA })
      .expect(200)

    const res = await supertest(httpServer)
      .post(`/v1/persons/${personA}/reassign`)
      .query({ userId })
      .send({ toPersonId: personB, faceIds: [faceId] })
      .expect(200)

    expect(res.body).toEqual({ moved: 1 })
  })

  it('unassigns faces when toPersonId is null', async () => {
    const userId = mintUserId()
    const personA = await createPerson(userId, 'a')
    const asset = await createAssetForUser(httpServer, userId)
    const faceId = await registerFaceForAsset(userId, asset.id)

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId, personId: personA })
      .expect(200)

    const res = await supertest(httpServer)
      .post(`/v1/persons/${personA}/reassign`)
      .query({ userId })
      .send({ toPersonId: null, faceIds: [faceId] })
      .expect(200)

    expect(res.body).toEqual({ moved: 1 })

    const facesRes = await supertest(httpServer).get(`/v1/assets/${asset.id}/faces`).expect(200)

    const face = (facesRes.body as { faces: { id: string; personId: string | null }[] }).faces[0]!
    expect(face.personId).toBeNull()
  })

  it('returns moved: 0 for empty faceIds', async () => {
    const userId = mintUserId()
    const personA = await createPerson(userId, 'a')
    const personB = await createPerson(userId, 'b')

    const res = await supertest(httpServer)
      .post(`/v1/persons/${personA}/reassign`)
      .query({ userId })
      .send({ toPersonId: personB, faceIds: [] })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })
})

describe('Persons — get assets for person', () => {
  it('returns assets containing the person', async () => {
    const userId = mintUserId()
    const personId = await createPerson(userId)
    const asset = await createAssetForUser(httpServer, userId)
    const faceId = await registerFaceForAsset(userId, asset.id)

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId, personId })
      .expect(200)

    const res = await supertest(httpServer)
      .get(`/v1/persons/${personId}/assets`)
      .query({ userId })
      .expect(200)

    const body = res.body as { personId: string; items: { assetId: string }[]; total: number }
    expect(body.personId).toBe(personId)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]!.assetId).toBe(asset.id)
    expect(body.total).toBe(1)
  })

  it('returns empty for person with no faces', async () => {
    const userId = mintUserId()
    const personId = await createPerson(userId)

    const res = await supertest(httpServer)
      .get(`/v1/persons/${personId}/assets`)
      .query({ userId })
      .expect(200)

    const body = res.body as { items: { assetId: string }[]; total: number }
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })
})

describe('Persons — cross-user isolation', () => {
  it('returns 404 when another user gets a person', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const personId = await createPerson(userA)

    await supertest(httpServer).get(`/v1/persons/${personId}`).query({ userId: userB }).expect(404)
  })

  it('returns 404 when another user patches a person', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const personId = await createPerson(userA)

    await supertest(httpServer)
      .patch(`/v1/persons/${personId}`)
      .query({ userId: userB })
      .send({ name: 'Hacked' })
      .expect(404)
  })

  it('returns 404 when another user sets cover', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const personId = await createPerson(userA)
    const asset = await createAssetForUser(httpServer, userA)
    const faceId = await registerFaceForAsset(userA, asset.id)

    await supertest(httpServer)
      .patch(`/v1/faces/${faceId}/person`)
      .send({ userId: userA, personId })
      .expect(200)

    await supertest(httpServer)
      .patch(`/v1/persons/${personId}/cover`)
      .send({ userId: userB, faceId })
      .expect(404)
  })
})
