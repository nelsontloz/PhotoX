import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
  apiServer,
} from './helpers';
import type { ApiTestApp } from './helpers';

describe('persons JWT identity', () => {
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

  async function seedPersonWithFace(userId: string) {
    const file = await seedFile(t, userId);
    const asset = await seedAsset(t, userId, file.id);
    const person = await t.personRepo.save(
      t.personRepo.create({ userId, name: null, clusterLabel: `c-${randomUUID()}`, faceCount: 1 }),
    );
    const face = await t.faceRepo.save(
      t.faceRepo.create({
        assetId: asset.id,
        userId,
        box: { x: 1, y: 1, w: 10, h: 10 },
        confidence: 0.9,
        embedding: [0.1, 0.2, 0.3],
        personId: person.id,
      }),
    );
    return { asset, person, face };
  }

  it('lists only the JWT user persons', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    await seedPersonWithFace(a.id);
    await seedPersonWithFace(b.id);
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role });
    const res = await request(apiServer(t)).get('/api/v1/persons').set(t.authHeader(tokenA));
    expect(res.status).toBe(200);
    const body = res.body as unknown as { items: { userId: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]?.userId).toBe(a.id);
  });

  it('scopes get and rename to JWT user', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const { person } = await seedPersonWithFace(a.id);
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role });
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role });
    const own = await request(apiServer(t))
      .get(`/api/v1/persons/${person.id}`)
      .set(t.authHeader(tokenA));
    expect(own.status).toBe(200);
    const cross = await request(apiServer(t))
      .get(`/api/v1/persons/${person.id}`)
      .query({ userId: a.id })
      .set(t.authHeader(tokenB));
    expect(cross.status).toBe(404);
    const rename = await request(apiServer(t))
      .patch(`/api/v1/persons/${person.id}`)
      .set(t.authHeader(tokenA))
      .send({ name: 'Ada' });
    expect(rename.status).toBe(200);
    const renameBody = rename.body as unknown as { name: string | null };
    expect(renameBody.name).toBe('Ada');
    const clear = await request(apiServer(t))
      .patch(`/api/v1/persons/${person.id}`)
      .set(t.authHeader(tokenA))
      .send({ name: null });
    expect(clear.status).toBe(200);
    expect((clear.body as unknown as { name: string | null }).name).toBeNull();
    expect((await t.personRepo.findOneByOrFail({ id: person.id })).name).toBeNull();
  });

  it('rejects cross-user rename', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const { person } = await seedPersonWithFace(a.id);
    const tokenB = t.signToken({ id: b.id, email: b.email, role: b.role });

    const crossPatch = await request(apiServer(t))
      .patch(`/api/v1/persons/${person.id}`)
      .set(t.authHeader(tokenB))
      .send({ name: 'Hijack' });
    expect(crossPatch.status).toBe(404);
    expect((await t.personRepo.findOneByOrFail({ id: person.id })).name).toBeNull();
  });

  it('queues cluster without userId', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const res = await request(apiServer(t))
      .post('/api/v1/persons/cluster')
      .set(t.authHeader(token));
    expect(res.status).toBe(202);
    const body = res.body as unknown as { queued: boolean };
    expect(body.queued).toBe(true);
  });

  it('returns 404 for an unknown person id', async () => {
    const user = await seedUser(t);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });
    const res = await request(apiServer(t))
      .get(`/api/v1/persons/${randomUUID()}`)
      .set(t.authHeader(token));
    expect(res.status).toBe(404);
  });
});
