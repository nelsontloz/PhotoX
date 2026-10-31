import request from 'supertest';
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
} from './helpers';
import type { ApiTestApp } from './helpers';

const PARIS = { latitude: 48.8566, longitude: 2.3522 };

describe('assets hasLocations filter', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
  });

  // direct repo update keeps these tests off the metadata patch / place-resolution path
  async function seedLocated(
    userId: string,
    coords: { latitude?: number; longitude?: number } | null,
    opts?: { isTrashed?: boolean },
  ): Promise<string> {
    const file = await seedFile(t, userId);
    const asset = await seedAsset(t, userId, file.id, { isTrashed: opts?.isTrashed });
    if (coords) await t.assetRepo.update(asset.id, coords);
    return asset.id;
  }

  it('hasLocations=true returns only fully geo-tagged own assets', async () => {
    const user = await seedUser(t);
    const other = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const geo = await seedLocated(user.id, PARIS);
    await seedLocated(user.id, { latitude: PARIS.latitude });
    await seedLocated(user.id, null);
    await seedLocated(user.id, PARIS, { isTrashed: true });
    await seedLocated(other.id, PARIS);

    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ hasLocations: true, limit: 100 })
      .set(t.authHeader(token));

    expect(res.status).toBe(200);
    const body = res.body as unknown as { items: { id: string }[]; total: number };
    expect(body.items.map((a) => a.id)).toEqual([geo]);
    expect(body.total).toBe(1);
  });

  it('returns all in-scope assets when omitted, and only unlocated ones for false', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const geo = await seedLocated(user.id, PARIS);
    const latOnly = await seedLocated(user.id, { latitude: PARIS.latitude });
    const plain = await seedLocated(user.id, null);
    const trashedGeo = await seedLocated(user.id, PARIS, { isTrashed: true });

    const all = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ limit: 100 })
      .set(t.authHeader(token));
    expect(all.status).toBe(200);
    const allIds = (all.body as { items: { id: string }[] }).items.map((a) => a.id);
    expect(allIds.sort()).toEqual([geo, latOnly, plain].sort());
    expect(allIds).not.toContain(trashedGeo);

    const without = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ hasLocations: false, limit: 100 })
      .set(t.authHeader(token));
    expect(without.status).toBe(200);
    expect((without.body as { items: { id: string }[] }).items.map((a) => a.id).sort()).toEqual(
      [latOnly, plain].sort(),
    );
  });

  it('keeps trashed geo assets out of the places map', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const geo = await seedLocated(user.id, PARIS);
    const trashedGeo = await seedLocated(user.id, PARIS, { isTrashed: true });

    const map = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ hasLocations: true, limit: 100 })
      .set(t.authHeader(token));
    expect(map.status).toBe(200);
    expect((map.body as { items: { id: string }[] }).items.map((a) => a.id)).toEqual([geo]);

    const trashed = await request(apiServer(t))
      .get('/api/v1/assets/trashed')
      .query({ hasLocations: true, limit: 100 })
      .set(t.authHeader(token));
    expect(trashed.status).toBe(200);
    expect((trashed.body as { items: { id: string }[] }).items.map((a) => a.id)).toEqual([
      trashedGeo,
    ]);
  });
});
