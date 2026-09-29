import request from 'supertest'
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

const FROM = '2026-06-01T00:00:00.000Z'
const TO = '2026-07-01T00:00:00.000Z'
const RANGE = { dateFrom: FROM, dateTo: TO, limit: 100 }

describe('assets list date range', () => {
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

  async function seedAt(
    userId: string,
    takenAt: string | null,
    opts?: { uploadedAt?: string; favorite?: boolean; isTrashed?: boolean },
  ): Promise<string> {
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id, { isTrashed: opts?.isTrashed })
    if (takenAt) await t.assetRepo.update(asset.id, { takenAt: new Date(takenAt) })
    if (opts?.uploadedAt) {
      await t.dataSource.query('UPDATE assets SET "uploadedAt" = $1 WHERE id = $2', [
        new Date(opts.uploadedAt),
        asset.id,
      ])
    }
    if (opts?.favorite) await t.assetRepo.update(asset.id, { favorite: true })
    return asset.id
  }

  it('filters half-open on COALESCE(takenAt, uploadedAt), including null takenAt', async () => {
    const user = await seedUser(t)
    const other = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const insideTaken = await seedAt(user.id, '2026-06-15T12:00:00.000Z', {
      uploadedAt: '2026-08-01T00:00:00.000Z',
    })
    const insideUploaded = await seedAt(user.id, null, { uploadedAt: '2026-06-20T00:00:00.000Z' })
    const atFrom = await seedAt(user.id, FROM)
    const atTo = await seedAt(user.id, TO)
    const before = await seedAt(user.id, '2026-05-31T23:59:59.999Z')
    const nullBefore = await seedAt(user.id, null, { uploadedAt: '2026-05-15T00:00:00.000Z' })
    const nullAfter = await seedAt(user.id, null, { uploadedAt: '2026-07-02T00:00:00.000Z' })
    const otherInside = await seedAt(other.id, '2026-06-10T00:00:00.000Z')

    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query(RANGE)
      .set(t.authHeader(token))

    expect(res.status).toBe(200)
    const body = res.body as unknown as { items: { id: string }[]; total: number }
    expect(body.items.map((a) => a.id).sort()).toEqual([insideTaken, insideUploaded, atFrom].sort())
    expect(body.total).toBe(3)
    for (const id of [atTo, before, nullBefore, nullAfter, otherInside]) {
      expect(body.items.map((a) => a.id)).not.toContain(id)
    }
  })

  it('supports one-sided ranges, exclusive end included', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const atFrom = await seedAt(user.id, FROM)
    const atTo = await seedAt(user.id, TO)
    const insideUploaded = await seedAt(user.id, null, { uploadedAt: '2026-06-20T00:00:00.000Z' })

    const fromOnly = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ dateFrom: FROM, limit: 100 })
      .set(t.authHeader(token))
    expect((fromOnly.body as { items: { id: string }[] }).items.map((a) => a.id).sort()).toEqual(
      [atFrom, atTo, insideUploaded].sort(),
    )

    const toOnly = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ dateTo: TO, limit: 100 })
      .set(t.authHeader(token))
    expect((toOnly.body as { items: { id: string }[] }).items.map((a) => a.id).sort()).toEqual(
      [atFrom, insideUploaded].sort(),
    )
  })

  it('composes with favorite and isTrashed', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const favoriteInside = await seedAt(user.id, '2026-06-12T00:00:00.000Z', { favorite: true })
    const favoriteOutside = await seedAt(user.id, '2026-05-01T00:00:00.000Z', { favorite: true })
    const plainInside = await seedAt(user.id, '2026-06-13T00:00:00.000Z')
    const trashedInside = await seedAt(user.id, '2026-06-10T00:00:00.000Z', { isTrashed: true })

    const fav = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ...RANGE, favorite: true })
      .set(t.authHeader(token))
    expect(fav.status).toBe(200)
    const favIds = (fav.body as { items: { id: string }[] }).items.map((a) => a.id)
    expect(favIds).toEqual([favoriteInside])
    expect(favIds).not.toContain(favoriteOutside)

    const trashed = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ...RANGE, isTrashed: true })
      .set(t.authHeader(token))
    expect(trashed.status).toBe(200)
    const trashedIds = (trashed.body as { items: { id: string }[] }).items.map((a) => a.id)
    expect(trashedIds).toEqual([trashedInside])
    expect(trashedIds).not.toContain(plainInside)
    expect(trashedIds).not.toContain(favoriteInside)
  })

  it('applies no implicit range when params are omitted', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const atTo = await seedAt(user.id, TO)
    const before = await seedAt(user.id, '2026-05-31T23:59:59.999Z')
    const inside = await seedAt(user.id, '2026-06-15T00:00:00.000Z')

    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ limit: 100 })
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    expect((res.body as { items: { id: string }[] }).items.map((a) => a.id).sort()).toEqual(
      [atTo, before, inside].sort(),
    )
  })

  it('rejects malformed date params', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const badFrom = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ dateFrom: 'june-2026' })
      .set(t.authHeader(token))
    expect(badFrom.status).toBe(400)

    const badTo = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ dateTo: '2026/07/01' })
      .set(t.authHeader(token))
    expect(badTo.status).toBe(400)
  })
})
