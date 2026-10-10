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

describe('assets layout', () => {
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

  it('returns only own non-trashed assets, coalesced and newest first', async () => {
    const user = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const dimsFile = await seedFile(t, user.id)
    const withDims = await seedAsset(t, user.id, dimsFile.id)
    await t.assetRepo.update(withDims.id, {
      takenAt: new Date('2024-03-02T10:00:00.000Z'),
      width: 4032,
      height: 3024,
    })

    const nullFile = await seedFile(t, user.id)
    const nullDims = await seedAsset(t, user.id, nullFile.id)
    await t.dataSource.query('UPDATE assets SET "uploadedAt" = $1 WHERE id = $2', [
      new Date('2024-01-05T08:30:00.000Z'),
      nullDims.id,
    ])

    const trashedFile = await seedFile(t, user.id)
    const trashed = await seedAsset(t, user.id, trashedFile.id, { isTrashed: true })
    await t.assetRepo.update(trashed.id, { takenAt: new Date('2024-04-01T00:00:00.000Z') })

    const otherFile = await seedFile(t, other.id)
    const otherAsset = await seedAsset(t, other.id, otherFile.id)
    await t.assetRepo.update(otherAsset.id, { takenAt: new Date('2024-05-01T00:00:00.000Z') })

    const res = await request(apiServer(t)).get('/api/v1/assets/layout').set(t.authHeader(token))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      items: [
        { t: '2024-03-02T10:00:00.000Z', w: 4032, h: 3024 },
        { t: '2024-01-05T08:30:00.000Z', w: 1, h: 1 },
      ],
    })
  })

  it('revalidates with ETag/304 and tiebreaks equal timestamps by newest upload', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const dimsFile = await seedFile(t, user.id)
    const withDims = await seedAsset(t, user.id, dimsFile.id)
    await t.assetRepo.update(withDims.id, {
      takenAt: new Date('2024-03-02T10:00:00.000Z'),
      width: 4032,
      height: 3024,
    })

    const first = await request(apiServer(t)).get('/api/v1/assets/layout').set(t.authHeader(token))
    expect(first.status).toBe(200)
    expect(first.headers.etag).toMatch(/^"layout-\d+-\d+"$/)
    expect(first.headers['cache-control']).toBe('private, no-cache')
    const firstEtag = first.headers.etag!

    const revalidated = await request(apiServer(t))
      .get('/api/v1/assets/layout')
      .set(t.authHeader(token))
      .set('If-None-Match', firstEtag)
    expect(revalidated.status).toBe(304)
    expect(revalidated.text).toBe('')

    // any layout-visible mutation bumps updatedAt → old ETag no longer matches
    await t.assetRepo.update(withDims.id, { width: 1000 })
    const mutated = await request(apiServer(t))
      .get('/api/v1/assets/layout')
      .set(t.authHeader(token))
      .set('If-None-Match', firstEtag)
    expect(mutated.status).toBe(200)
    expect(mutated.headers.etag).not.toBe(firstEtag)

    // tiebreak: equal effective timestamps fall back to newest uploadedAt first
    const olderFile = await seedFile(t, user.id)
    const older = await seedAsset(t, user.id, olderFile.id, { width: 10 })
    const newerFile = await seedFile(t, user.id)
    const newer = await seedAsset(t, user.id, newerFile.id, { width: 20 })
    const sameTaken = new Date('2024-02-01T00:00:00.000Z')
    await t.assetRepo.update(older.id, { takenAt: sameTaken })
    await t.assetRepo.update(newer.id, { takenAt: sameTaken })
    await t.dataSource.query('UPDATE assets SET "uploadedAt" = $1 WHERE id = $2', [
      new Date('2024-01-01T00:00:00.000Z'),
      older.id,
    ])
    await t.dataSource.query('UPDATE assets SET "uploadedAt" = $1 WHERE id = $2', [
      new Date('2024-06-01T00:00:00.000Z'),
      newer.id,
    ])

    const tied = await request(apiServer(t)).get('/api/v1/assets/layout').set(t.authHeader(token))
    expect(tied.status).toBe(200)
    const tiedBody = tied.body as { items: { t: string; w: number; h: number }[] }
    const tiedItems = tiedBody.items.filter((i) => i.t === sameTaken.toISOString())
    expect(tiedItems).toEqual([
      { t: sameTaken.toISOString(), w: 20, h: 1 },
      { t: sameTaken.toISOString(), w: 10, h: 1 },
    ])
  })

  it('scopes layout to a person, and to the requesting user', async () => {
    const user = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const faceFile = await seedFile(t, user.id)
    const withFace = await seedAsset(t, user.id, faceFile.id)
    await t.assetRepo.update(withFace.id, {
      takenAt: new Date('2024-03-02T10:00:00.000Z'),
      width: 4032,
      height: 3024,
    })

    const plainFile = await seedFile(t, user.id)
    const plain = await seedAsset(t, user.id, plainFile.id)
    await t.assetRepo.update(plain.id, { takenAt: new Date('2024-01-05T08:30:00.000Z') })

    const person = await t.personRepo.save(
      t.personRepo.create({
        userId: user.id,
        name: null,
        clusterLabel: `c-${randomUUID()}`,
        faceCount: 1,
      }),
    )
    await t.faceRepo.save(
      t.faceRepo.create({
        assetId: withFace.id,
        userId: user.id,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: person.id,
      }),
    )

    const otherFile = await seedFile(t, other.id)
    const otherAsset = await seedAsset(t, other.id, otherFile.id)
    const otherPerson = await t.personRepo.save(
      t.personRepo.create({
        userId: other.id,
        name: null,
        clusterLabel: `c-${randomUUID()}`,
        faceCount: 1,
      }),
    )
    await t.faceRepo.save(
      t.faceRepo.create({
        assetId: otherAsset.id,
        userId: other.id,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: otherPerson.id,
      }),
    )

    const filtered = await request(apiServer(t))
      .get('/api/v1/assets/layout')
      .query({ personId: person.id })
      .set(t.authHeader(token))
    expect(filtered.status).toBe(200)
    expect(filtered.body).toEqual({
      items: [{ t: '2024-03-02T10:00:00.000Z', w: 4032, h: 3024 }],
    })

    const all = await request(apiServer(t)).get('/api/v1/assets/layout').set(t.authHeader(token))
    expect(all.status).toBe(200)
    expect((all.body as { items: unknown[] }).items).toHaveLength(2)

    const foreign = await request(apiServer(t))
      .get('/api/v1/assets/layout')
      .query({ personId: otherPerson.id })
      .set(t.authHeader(token))
    expect(foreign.status).toBe(200)
    expect(foreign.body).toEqual({ items: [] })
  })

  it('scopes layout to favorites and to an album', async () => {
    const user = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const favFile = await seedFile(t, user.id)
    const favorite = await seedAsset(t, user.id, favFile.id)
    await t.assetRepo.update(favorite.id, {
      takenAt: new Date('2024-03-02T10:00:00.000Z'),
      width: 4032,
      height: 3024,
      favorite: true,
    })

    const memberFile = await seedFile(t, user.id)
    const member = await seedAsset(t, user.id, memberFile.id)
    await t.assetRepo.update(member.id, { takenAt: new Date('2024-02-01T00:00:00.000Z') })

    const plainFile = await seedFile(t, user.id)
    const plain = await seedAsset(t, user.id, plainFile.id)
    await t.assetRepo.update(plain.id, { takenAt: new Date('2024-01-05T08:30:00.000Z') })

    const album = await t.albumRepo.save(
      t.albumRepo.create({ userId: user.id, name: 'Trip', description: null }),
    )
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId: album.id, assetId: member.id }))

    const otherFile = await seedFile(t, other.id)
    const otherAsset = await seedAsset(t, other.id, otherFile.id)
    const otherAlbum = await t.albumRepo.save(
      t.albumRepo.create({ userId: other.id, name: 'Theirs', description: null }),
    )
    await t.albumAssetRepo.save(
      t.albumAssetRepo.create({ albumId: otherAlbum.id, assetId: otherAsset.id }),
    )

    const favs = await request(apiServer(t))
      .get('/api/v1/assets/layout')
      .query({ favorite: true })
      .set(t.authHeader(token))
    expect(favs.status).toBe(200)
    expect(favs.body).toEqual({ items: [{ t: '2024-03-02T10:00:00.000Z', w: 4032, h: 3024 }] })

    const inAlbum = await request(apiServer(t))
      .get('/api/v1/assets/layout')
      .query({ albumId: album.id })
      .set(t.authHeader(token))
    expect(inAlbum.status).toBe(200)
    expect(inAlbum.body).toEqual({ items: [{ t: '2024-02-01T00:00:00.000Z', w: 1, h: 1 }] })

    const all = await request(apiServer(t)).get('/api/v1/assets/layout').set(t.authHeader(token))
    expect(all.status).toBe(200)
    expect((all.body as { items: unknown[] }).items).toHaveLength(3)

    const foreign = await request(apiServer(t))
      .get('/api/v1/assets/layout')
      .query({ albumId: otherAlbum.id })
      .set(t.authHeader(token))
    expect(foreign.status).toBe(200)
    expect(foreign.body).toEqual({ items: [] })
  })
})
