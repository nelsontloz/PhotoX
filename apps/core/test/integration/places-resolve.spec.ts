import request from 'supertest'
import type { Repository } from 'typeorm'
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
import { Place } from '../../src/database/entities/place.entity'
import { PlacesResolveService } from '../../src/places/places-resolve.service'

const PARIS = { latitude: 48.8566, longitude: 2.3522 }
const LYON = { latitude: 45.7485, longitude: 4.8467 }
// South Atlantic: nearest seeded city is thousands of km away
const OPEN_OCEAN = { latitude: -30, longitude: -30 }

describe('places resolution', () => {
  let t: ApiTestApp
  let placeRepo: Repository<Place>

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null })
    placeRepo = t.dataSource.getRepository(Place)
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(async () => {
    await resetDb(t)
    await placeRepo.save([
      placeRepo.create({
        geonameId: 2988507,
        name: 'Paris',
        latitude: PARIS.latitude,
        longitude: PARIS.longitude,
        countryCode: 'FR',
        admin1Code: '11',
        timezone: 'Europe/Paris',
      }),
      placeRepo.create({
        geonameId: 2996944,
        name: 'Lyon',
        latitude: LYON.latitude,
        longitude: LYON.longitude,
        countryCode: 'FR',
        admin1Code: '84',
        timezone: 'Europe/Paris',
      }),
    ])
  })

  async function seedOwnedAsset(userId: string) {
    const file = await seedFile(t, userId)
    return seedAsset(t, userId, file.id)
  }

  it('fills place fields when a metadata patch brings coordinates', async () => {
    const user = await seedUser(t)
    const asset = await seedOwnedAsset(user.id)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(token))
      .send(PARIS)
    expect(res.status).toBe(200)

    const row = await t.assetRepo.findOneOrFail({ where: { id: asset.id } })
    expect(row.placeCity).toBe('Paris')
    expect(row.placeAdmin1).toBe('11')
    expect(row.placeCountryCode).toBe('FR')
    expect(row.placeTimezone).toBe('Europe/Paris')
    expect(Number(row.placeDistanceKm)).toBeLessThan(1)
  })

  it('leaves place fields null when the nearest city is beyond 50km', async () => {
    const user = await seedUser(t)
    const asset = await seedOwnedAsset(user.id)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(token))
      .send(OPEN_OCEAN)
    expect(res.status).toBe(200)

    const row = await t.assetRepo.findOneOrFail({ where: { id: asset.id } })
    expect(row.placeCity).toBeNull()
    expect(row.placeAdmin1).toBeNull()
    expect(row.placeCountryCode).toBeNull()
    expect(row.placeTimezone).toBeNull()
    expect(row.placeDistanceKm).toBeNull()
  })

  it('never overwrites an already resolved city', async () => {
    const user = await seedUser(t)
    const asset = await seedOwnedAsset(user.id)
    await t.assetRepo.update(asset.id, { placeCity: 'Atlantis' })
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(token))
      .send(PARIS)
    expect(res.status).toBe(200)

    const row = await t.assetRepo.findOneOrFail({ where: { id: asset.id } })
    expect(row.placeCity).toBe('Atlantis')
  })

  it('never resolves when a metadata patch carries null coordinates', async () => {
    const user = await seedUser(t)
    const asset = await seedOwnedAsset(user.id)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const resolveSpy = vi.spyOn(t.app.get(PlacesResolveService), 'resolve')

    // worker no-GPS branch spreads latitude: null, longitude: null
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(token))
      .send({ latitude: null, longitude: null })
    expect(res.status).toBe(200)
    expect(resolveSpy).not.toHaveBeenCalled()

    const row = await t.assetRepo.findOneOrFail({ where: { id: asset.id } })
    expect(row.placeCity).toBeNull()
    expect(row.placeDistanceKm).toBeNull()
  })

  it('does not fail the metadata write when places is empty', async () => {
    const user = await seedUser(t)
    const asset = await seedOwnedAsset(user.id)
    await placeRepo.clear()
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(token))
      .send(PARIS)
    expect(res.status).toBe(200)

    const row = await t.assetRepo.findOneOrFail({ where: { id: asset.id } })
    expect(row.placeCity).toBeNull()
    expect(Number(row.latitude)).toBeCloseTo(PARIS.latitude, 5)
  })

  it('backfills all users unresolved assets and records the run', async () => {
    const admin = await seedUser(t, { role: 'admin' })
    const owner = await seedUser(t)

    const near = await seedOwnedAsset(owner.id)
    await t.assetRepo.update(near.id, PARIS)
    const far = await seedOwnedAsset(owner.id)
    await t.assetRepo.update(far.id, OPEN_OCEAN)
    const done = await seedOwnedAsset(owner.id)
    await t.assetRepo.update(done.id, { ...LYON, placeCity: 'Lyon' })

    const token = t.signToken({ id: admin.id, email: admin.email, role: admin.role })
    const res = await request(apiServer(t))
      .post('/api/v1/admin/places/backfill')
      .set(t.authHeader(token))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ updated: 1, total: 2 })

    expect((await t.assetRepo.findOneOrFail({ where: { id: near.id } })).placeCity).toBe('Paris')
    expect((await t.assetRepo.findOneOrFail({ where: { id: far.id } })).placeCity).toBeNull()
    expect((await t.assetRepo.findOneOrFail({ where: { id: done.id } })).placeCity).toBe('Lyon')

    const status = await request(apiServer(t))
      .get('/api/v1/admin/places/backfill')
      .set(t.authHeader(token))
    expect(status.status).toBe(200)
    const body = status.body as { lastRun: { total: number; updated: number } | null }
    expect(body.lastRun?.total).toBe(2)
    expect(body.lastRun?.updated).toBe(1)
  })

  it('requires admin on the backfill endpoints', async () => {
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })

    const forbidden = await request(apiServer(t))
      .post('/api/v1/admin/places/backfill')
      .set(t.authHeader(token))
    expect(forbidden.status).toBe(403)

    const forbiddenStatus = await request(apiServer(t))
      .get('/api/v1/admin/places/backfill')
      .set(t.authHeader(token))
    expect(forbiddenStatus.status).toBe(403)

    const anonymous = await request(apiServer(t)).post('/api/v1/admin/places/backfill')
    expect(anonymous.status).toBe(401)
  })
})
