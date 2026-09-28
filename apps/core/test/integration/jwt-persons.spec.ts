import request from 'supertest'
import { randomUUID } from 'node:crypto'
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

describe('persons JWT identity', () => {
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

  async function seedPersonWithFace(userId: string) {
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    const person = await t.personRepo.save(
      t.personRepo.create({ userId, name: null, clusterLabel: `c-${randomUUID()}`, faceCount: 1 }),
    )
    const face = await t.faceRepo.save(
      t.faceRepo.create({
        assetId: asset.id,
        userId,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: person.id,
      }),
    )
    return { asset, person, face }
  }

  it('lists without userId and ignores query userId', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    await seedPersonWithFace(a.id)
    await seedPersonWithFace(b.id)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const res = await request(apiServer(t))
      .get('/api/v1/persons')
      .query({ userId: b.id })
      .set(t.authHeader(tokenA))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { userId: string }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]?.userId).toBe(a.id)
  })

  it('scopes get and rename to JWT user', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const { person } = await seedPersonWithFace(a.id)
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role })
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const own = await request(apiServer(t))
      .get(`/api/v1/persons/${person.id}`)
      .set(t.authHeader(tokenA))
    expect(own.status).toBe(200)
    const cross = await request(apiServer(t))
      .get(`/api/v1/persons/${person.id}`)
      .query({ userId: a.id })
      .set(t.authHeader(tokenB))
    expect(cross.status).toBe(404)
    const rename = await request(apiServer(t))
      .patch(`/api/v1/persons/${person.id}`)
      .set(t.authHeader(tokenA))
      .send({ name: 'Ada' })
    expect(rename.status).toBe(200)
    const renameBody = rename.body as unknown as { name: string | null }
    expect(renameBody.name).toBe('Ada')
  })

  it('gets person assets without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { person } = await seedPersonWithFace(user.id)
    const res = await request(apiServer(t))
      .get(`/api/v1/persons/${person.id}/assets`)
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    const body = res.body as unknown as { personId: string; total: number }
    expect(body.personId).toBe(person.id)
    expect(body.total).toBe(1)
  })

  it('reassigns faces without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const first = await seedPersonWithFace(user.id)
    const second = await t.personRepo.save(
      t.personRepo.create({ userId: user.id, name: null, clusterLabel: `c-${randomUUID()}` }),
    )
    const res = await request(apiServer(t))
      .post(`/api/v1/persons/${first.person.id}/reassign`)
      .set(t.authHeader(token))
      .send({ toPersonId: second.id, faceIds: [first.face.id] })
    expect(res.status).toBe(200)
    const body = res.body as unknown as { moved: number }
    expect(body.moved).toBe(1)
  })

  it('queues cluster without userId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t)).post('/api/v1/persons/cluster').set(t.authHeader(token))
    expect(res.status).toBe(202)
    const body = res.body as unknown as { queued: boolean }
    expect(body.queued).toBe(true)
  })

  it('returns 401 without token', async () => {
    const res = await request(apiServer(t)).get('/api/v1/persons')
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed token', async () => {
    const res = await request(apiServer(t))
      .get('/api/v1/persons')
      .set({ Authorization: 'Bearer not-a-token' })
    expect(res.status).toBe(401)
  })

  it('creates a person scoped to the JWT user', async () => {
    const owner = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: owner.id, email: owner.email, role: owner.role })
    const res = await request(apiServer(t))
      .post('/api/v1/persons')
      .set(t.authHeader(token))
      .send({ clusterLabel: 'cluster-1', userId: other.id })
    expect(res.status).toBe(201)
    const { id } = res.body as unknown as { id: string }
    const person = await t.personRepo.findOneByOrFail({ id })
    expect(person.userId).toBe(owner.id)
    expect(person.clusterLabel).toBe('cluster-1')
  })

  it('rejects invalid person create bodies with 400', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const missing = await request(apiServer(t))
      .post('/api/v1/persons')
      .set(t.authHeader(token))
      .send({})
    expect(missing.status).toBe(400)
    const badUser = await request(apiServer(t))
      .post('/api/v1/persons')
      .set(t.authHeader(token))
      .send({ clusterLabel: 'c-1', userId: 'not-a-uuid' })
    expect(badUser.status).toBe(400)
  })

  it('sets a cover face and persists coverFaceId', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { person, face } = await seedPersonWithFace(user.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/persons/${person.id}/cover`)
      .set(t.authHeader(token))
      .send({ faceId: face.id })
    expect(res.status).toBe(200)
    expect((res.body as unknown as { ok: boolean }).ok).toBe(true)
    const updated = await t.personRepo.findOneByOrFail({ id: person.id })
    expect(updated.coverFaceId).toBe(face.id)
  })

  it('404s setting a cover from an unknown face', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { person } = await seedPersonWithFace(user.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/persons/${person.id}/cover`)
      .set(t.authHeader(token))
      .send({ faceId: randomUUID() })
    expect(res.status).toBe(404)
  })

  it('404s cover changes on a cross-user person', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const { person, face } = await seedPersonWithFace(a.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/persons/${person.id}/cover`)
      .set(t.authHeader(tokenB))
      .send({ faceId: face.id })
    expect(res.status).toBe(404)
  })

  it('returns 404 for an unknown person id', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const res = await request(apiServer(t))
      .get(`/api/v1/persons/${randomUUID()}`)
      .set(t.authHeader(token))
    expect(res.status).toBe(404)
  })

  async function seedFace(userId: string) {
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    const face = await t.faceRepo.save(
      t.faceRepo.create({
        assetId: asset.id,
        userId,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
      }),
    )
    return { asset, face }
  }

  it('applies a cluster plan with creates, attaches and covers', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const createFaceA = await seedFace(user.id)
    const createFaceB = await seedFace(user.id)
    const existing = await seedPersonWithFace(user.id)
    const attachFace = await seedFace(user.id)

    const res = await request(apiServer(t))
      .post('/api/v1/persons/apply-clusters')
      .set(t.authHeader(token))
      .send({
        creates: [
          {
            clusterLabel: 'cluster-new',
            faceIds: [createFaceA.face.id, createFaceB.face.id],
            coverFaceId: createFaceA.face.id,
          },
        ],
        attaches: [
          {
            personId: existing.person.id,
            faceIds: [attachFace.face.id],
            coverFaceId: attachFace.face.id,
          },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ created: 1, assigned: 3 })

    const created = await t.personRepo.findOneByOrFail({ clusterLabel: 'cluster-new' })
    expect(created.userId).toBe(user.id)
    expect(created.name).toBeNull()
    expect(created.coverFaceId).toBe(createFaceA.face.id)
    expect(created.faceCount).toBe(2)
    expect((await t.faceRepo.findOneByOrFail({ id: createFaceA.face.id })).personId).toBe(
      created.id,
    )
    expect((await t.faceRepo.findOneByOrFail({ id: createFaceB.face.id })).personId).toBe(
      created.id,
    )
    expect((await t.faceRepo.findOneByOrFail({ id: attachFace.face.id })).personId).toBe(
      existing.person.id,
    )
    const existingUpdated = await t.personRepo.findOneByOrFail({ id: existing.person.id })
    expect(existingUpdated.coverFaceId).toBe(attachFace.face.id)
    expect(existingUpdated.faceCount).toBe(2)
  })

  it('404s a cluster plan referencing cross-user faces or persons without mutating', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role })
    const faceA = await seedFace(a.id)
    const { person: personA } = await seedPersonWithFace(a.id)
    const faceB = await seedFace(b.id)

    const foreignFace = await request(apiServer(t))
      .post('/api/v1/persons/apply-clusters')
      .set(t.authHeader(tokenB))
      .send({ creates: [{ clusterLabel: 'x', faceIds: [faceA.face.id] }], attaches: [] })
    expect(foreignFace.status).toBe(404)

    const foreignPerson = await request(apiServer(t))
      .post('/api/v1/persons/apply-clusters')
      .set(t.authHeader(tokenB))
      .send({ creates: [], attaches: [{ personId: personA.id, faceIds: [faceB.face.id] }] })
    expect(foreignPerson.status).toBe(404)

    expect(await t.personRepo.count()).toBe(1)
    expect((await t.faceRepo.findOneByOrFail({ id: faceA.face.id })).personId).toBeNull()
    expect((await t.faceRepo.findOneByOrFail({ id: faceB.face.id })).personId).toBeNull()
  })

  it('400s a cluster plan whose coverFaceId is not in its faceIds', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const first = await seedFace(user.id)
    const second = await seedFace(user.id)
    const res = await request(apiServer(t))
      .post('/api/v1/persons/apply-clusters')
      .set(t.authHeader(token))
      .send({
        creates: [{ clusterLabel: 'x', faceIds: [first.face.id], coverFaceId: second.face.id }],
        attaches: [],
      })
    expect(res.status).toBe(400)
    expect(await t.personRepo.count()).toBe(0)
    expect((await t.faceRepo.findOneByOrFail({ id: first.face.id })).personId).toBeNull()
  })

  it('refreshes both counts when apply-clusters moves a face off its current person', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const from = await seedPersonWithFace(user.id)
    const to = await t.personRepo.save(
      t.personRepo.create({ userId: user.id, name: null, clusterLabel: `c-${randomUUID()}` }),
    )
    const res = await request(apiServer(t))
      .post('/api/v1/persons/apply-clusters')
      .set(t.authHeader(token))
      .send({ creates: [], attaches: [{ personId: to.id, faceIds: [from.face.id] }] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ created: 0, assigned: 1 })
    expect((await t.faceRepo.findOneByOrFail({ id: from.face.id })).personId).toBe(to.id)
    expect((await t.personRepo.findOneByOrFail({ id: from.person.id })).faceCount).toBe(0)
    expect((await t.personRepo.findOneByOrFail({ id: to.id })).faceCount).toBe(1)
  })

  it('rejects missing or garbage cluster payloads with 400 and accepts empty arrays', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const { face } = await seedFace(user.id)

    const missing = await request(apiServer(t))
      .post('/api/v1/persons/apply-clusters')
      .set(t.authHeader(token))
      .send({})
    expect(missing.status).toBe(400)

    const garbage = await request(apiServer(t))
      .post('/api/v1/persons/apply-clusters')
      .set(t.authHeader(token))
      .send({
        creates: [{ clusterLabel: 'x', faceIds: [face.id], junk: true }],
        attaches: [],
      })
    expect(garbage.status).toBe(400)

    const empty = await request(apiServer(t))
      .post('/api/v1/persons/apply-clusters')
      .set(t.authHeader(token))
      .send({ creates: [], attaches: [] })
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({ created: 0, assigned: 0 })
  })
})
