import request from 'supertest'
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

// The timeline hides rows whose date or tile isn't settled yet (see AssetsService gate):
// metadataStatus='pending' or thumbnailStatus='pending'.
describe('assets timeline visibility gate', () => {
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

  it('hides pending assets from list and layout, but not from id lookups', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const readyFile = await seedFile(t, user.id)
    const ready = await seedAsset(t, user.id, readyFile.id)
    await t.assetRepo.update(ready.id, { takenAt: new Date('2024-03-02T10:00:00.000Z') })

    const pendingMetaFile = await seedFile(t, user.id)
    const pendingMeta = await seedAsset(t, user.id, pendingMetaFile.id, {
      metadataStatus: 'pending',
    })
    const pendingThumbFile = await seedFile(t, user.id)
    const pendingThumb = await seedAsset(t, user.id, pendingThumbFile.id, {
      thumbnailStatus: 'pending',
    })

    const list = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(token))
    expect(list.status).toBe(200)
    expect((list.body as { items: { id: string }[] }).items.map((a) => a.id)).toEqual([ready.id])
    expect((list.body as { total: number }).total).toBe(1)

    const layout = await request(apiServer(t)).get('/api/v1/assets/layout').set(t.authHeader(token))
    expect(layout.status).toBe(200)
    expect(layout.body).toEqual({
      pending: 2,
      items: [{ t: '2024-03-02T10:00:00.000Z', w: 1, h: 1 }],
    })

    // explicit id lookups bypass the gate — the upload client polls them while settling
    const byIds = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ids: [pendingMeta.id, pendingThumb.id].join(',') })
      .set(t.authHeader(token))
    expect(byIds.status).toBe(200)
    expect((byIds.body as { items: { id: string }[] }).items).toHaveLength(2)

    const one = await request(apiServer(t))
      .get(`/api/v1/assets/${pendingMeta.id}`)
      .set(t.authHeader(token))
    expect(one.status).toBe(200)
  })

  it('shows the asset once metadata and thumbnail settle, and reports failed as settled', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id, { metadataStatus: 'pending' })
    await t.assetRepo.update(asset.id, { takenAt: new Date('2021-07-04T12:00:00.000Z') })

    const before = await request(apiServer(t)).get('/api/v1/assets/layout').set(t.authHeader(token))
    expect(before.body).toEqual({ pending: 1, items: [] })

    await t.assetRepo.update(asset.id, { metadataStatus: 'ready', thumbnailStatus: 'ready' })
    const after = await request(apiServer(t)).get('/api/v1/assets/layout').set(t.authHeader(token))
    expect(after.body).toEqual({
      pending: 0,
      items: [{ t: '2021-07-04T12:00:00.000Z', w: 1, h: 1 }],
    })

    // a file with no EXIF fails metadata extraction but is still a photo on the timeline
    const noExifFile = await seedFile(t, user.id)
    const noExif = await seedAsset(t, user.id, noExifFile.id, {
      metadataStatus: 'failed',
      thumbnailStatus: null,
    })
    const list = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(token))
    const ids = (list.body as { items: { id: string }[] }).items.map((a) => a.id)
    expect(ids).toContain(noExif.id)
  })

  it('keeps pending assets visible in trash', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const file = await seedFile(t, user.id)
    const trashed = await seedAsset(t, user.id, file.id, {
      isTrashed: true,
      metadataStatus: 'pending',
      thumbnailStatus: 'pending',
    })

    const res = await request(apiServer(t)).get('/api/v1/assets/trashed').set(t.authHeader(token))
    expect(res.status).toBe(200)
    expect((res.body as { items: { id: string }[] }).items.map((a) => a.id)).toEqual([trashed.id])
  })
})
