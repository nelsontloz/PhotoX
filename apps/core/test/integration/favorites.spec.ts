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

describe('assets favorite filter', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    t = await createApiTestApp();
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
  });

  // explicit uploadedAt: the list orders by COALESCE(takenAt, uploadedAt) DESC, so a wall-clock
  // tie would make the expected order depend on insert timing
  async function seedAt(
    userId: string,
    uploadedAt: string,
    opts?: { favorite?: boolean; isTrashed?: boolean },
  ): Promise<string> {
    const file = await seedFile(t, userId);
    const asset = await seedAsset(t, userId, file.id, { isTrashed: opts?.isTrashed });
    await t.dataSource.query('UPDATE assets SET "uploadedAt" = $1 WHERE id = $2', [
      new Date(uploadedAt),
      asset.id,
    ]);
    if (opts?.favorite) await t.assetRepo.update(asset.id, { favorite: true });
    return asset.id;
  }

  it('lists only my favorited, non-trashed assets', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const favorite = await seedAt(user.id, '2024-01-03T00:00:00.000Z', { favorite: true });
    await seedAt(user.id, '2024-01-02T00:00:00.000Z', { favorite: true, isTrashed: true });
    await seedAt(user.id, '2024-01-01T00:00:00.000Z');

    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, limit: 100 })
      .set(t.authHeader(token));

    expect(res.status).toBe(200);
    const body = res.body as unknown as { items: { id: string }[]; total: number };
    expect(body.items.map((a) => a.id)).toEqual([favorite]);
    expect(body.total).toBe(1);
  });

  it('keeps favorites isolated between users', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role });
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role });
    const aOne = await seedAt(a.id, '2024-02-02T00:00:00.000Z', { favorite: true });
    const aTwo = await seedAt(a.id, '2024-02-01T00:00:00.000Z', { favorite: true });
    const bOne = await seedAt(b.id, '2024-02-03T00:00:00.000Z', { favorite: true });

    const listA = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, limit: 100 })
      .set(t.authHeader(tokenA));
    expect(listA.status).toBe(200);
    const bodyA = listA.body as unknown as { items: { id: string }[]; total: number };
    expect(bodyA.items.map((i) => i.id)).toEqual([aOne, aTwo]);
    expect(bodyA.items.map((i) => i.id)).not.toContain(bOne);
    expect(bodyA.total).toBe(2);

    const listB = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, limit: 100 })
      .set(t.authHeader(tokenB));
    expect(listB.status).toBe(200);
    const bodyB = listB.body as unknown as { items: { id: string }[]; total: number };
    expect(bodyB.items.map((i) => i.id)).toEqual([bOne]);
    expect(bodyB.items.map((i) => i.id)).not.toContain(aOne);
    expect(bodyB.total).toBe(1);
  });

  it('paginates favorites without overlap', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const newest = await seedAt(user.id, '2024-03-02T00:00:00.000Z', { favorite: true });
    const oldest = await seedAt(user.id, '2024-03-01T00:00:00.000Z', { favorite: true });
    await seedAt(user.id, '2024-03-03T00:00:00.000Z');

    const first = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, limit: 1, offset: 0 })
      .set(t.authHeader(token));
    expect(first.status).toBe(200);
    const firstBody = first.body as unknown as { items: { id: string }[]; total: number };
    expect(firstBody.total).toBe(2);
    expect(firstBody.items.map((i) => i.id)).toEqual([newest]);

    const second = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, limit: 1, offset: 1 })
      .set(t.authHeader(token));
    expect(second.status).toBe(200);
    const secondBody = second.body as unknown as { items: { id: string }[]; total: number };
    expect(secondBody.total).toBe(2);
    expect(secondBody.items.map((i) => i.id)).toEqual([oldest]);

    const firstIds = firstBody.items.map((i) => i.id);
    const secondIds = secondBody.items.map((i) => i.id);
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
  });

  it('PATCH favorite:false removes the asset from the filter', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const assetId = await seedAt(user.id, '2024-04-01T00:00:00.000Z', { favorite: true });

    const before = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, limit: 100 })
      .set(t.authHeader(token));
    expect((before.body as { total: number }).total).toBe(1);

    const patch = await request(apiServer(t))
      .patch(`/api/v1/assets/${assetId}`)
      .set(t.authHeader(token))
      .send({ favorite: false });
    expect(patch.status).toBe(200);
    expect((patch.body as { favorite: boolean }).favorite).toBe(false);

    const after = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, limit: 100 })
      .set(t.authHeader(token));
    expect(after.status).toBe(200);
    const body = after.body as unknown as { items: { id: string }[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('trashing a favorite removes it from the filter', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const assetId = await seedAt(user.id, '2024-05-01T00:00:00.000Z', { favorite: true });

    const trash = await request(apiServer(t))
      .post(`/api/v1/assets/${assetId}/trash`)
      .set(t.authHeader(token));
    expect(trash.status).toBe(204);

    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, limit: 100 })
      .set(t.authHeader(token));
    expect(res.status).toBe(200);
    const body = res.body as unknown as { items: { id: string }[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);

    // the asset is trashed, not gone: the trash view still lists it
    const trashed = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: true, isTrashed: true, limit: 100 })
      .set(t.authHeader(token));
    expect((trashed.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([assetId]);
  });

  // the DTO coerces the query string through isQueryTrue before @IsBoolean runs, so only the
  // literal 'true' means true and any other value is false — a typo fails closed (never shows
  // favorites) instead of 400ing. Asserts the real contract, not the plan doc's 400.
  it('rejects a non-boolean favorite query value as false', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const favorite = await seedAt(user.id, '2024-06-02T00:00:00.000Z', { favorite: true });
    const notFavorite = await seedAt(user.id, '2024-06-01T00:00:00.000Z');

    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ favorite: 'yes', limit: 100 })
      .set(t.authHeader(token));

    expect(res.status).toBe(200);
    const body = res.body as unknown as { items: { id: string }[]; total: number };
    expect(body.items.map((a) => a.id)).toEqual([notFavorite]);
    expect(body.items.map((a) => a.id)).not.toContain(favorite);
    expect(body.total).toBe(1);
  });
});
