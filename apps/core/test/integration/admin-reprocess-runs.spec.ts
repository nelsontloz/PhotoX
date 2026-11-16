import request from 'supertest';
import { apiServer, closeTestApp, createApiTestApp, resetDb, seedUser } from './helpers';
import type { ApiTestApp } from './helpers';
import { adminAuthHarness } from './helpers/reprocess-matrix';
import type { User } from '../../src/database/entities/user.entity';

const RUNS = '/api/v1/admin/reprocess-runs';

/**
 * One resource for every bulk pipeline: `POST /reprocess-runs {kind}` starts a run and points at
 * `GET /reprocess-runs/:kind`, which reports the last recorded run and the live queue depth. The six
 * per-pipeline POST/GET pairs stay as deprecated aliases.
 */
describe('admin reprocess runs', () => {
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

  async function adminAuth(): Promise<{ admin: User; auth: Record<string, string> }> {
    const admin = await seedUser(t, { role: 'admin' });
    return {
      admin,
      auth: t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role })),
    };
  }

  it('rejects anonymous and non-admin callers', async () => {
    await adminAuthHarness(t, { post: [RUNS], get: [`${RUNS}/faces`] });
  });

  it('starts a run and points at its status route', async () => {
    const { auth } = await adminAuth();

    const res = await request(apiServer(t)).post(RUNS).set(auth).send({ kind: 'faces' });

    expect(res.status).toBe(202);
    expect(res.headers.location).toBe(`${RUNS}/faces`);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body).toEqual({ kind: 'faces', enqueued: 0, total: 0 });
  });

  it('reports the last recorded run and the live queue depth', async () => {
    const { auth } = await adminAuth();
    const server = apiServer(t);

    const started = await request(server).post(RUNS).set(auth).send({ kind: 'metadata' });
    expect(started.status).toBe(202);

    const res = await request(server).get(`${RUNS}/metadata`).set(auth);
    expect(res.status).toBe(200);
    const body = res.body as {
      kind: string;
      lastRun: { total: number; enqueued: number } | null;
      queue: Record<string, number>;
    };
    expect(body.kind).toBe('metadata');
    expect(body.lastRun).toMatchObject({ total: 0, enqueued: 0 });
    expect(typeof body.queue.waiting).toBe('number');
  });

  it('rejects an unknown kind and a thumbnails run without assetKind', async () => {
    const { auth } = await adminAuth();
    const server = apiServer(t);

    const unknownParam = await request(server).get(`${RUNS}/nope`).set(auth);
    expect(unknownParam.status).toBe(400);

    const unknownBody = await request(server).post(RUNS).set(auth).send({ kind: 'nope' });
    expect(unknownBody.status).toBe(400);

    const missingAssetKind = await request(server)
      .post(RUNS)
      .set(auth)
      .send({ kind: 'thumbnails' });
    expect(missingAssetKind.status).toBe(400);
    expect((missingAssetKind.body as { message: string }).message).toContain('assetKind');
  });

  it('keeps the per-pipeline routes working as deprecated aliases', async () => {
    const { auth } = await adminAuth();
    const server = apiServer(t);

    const started = await request(server).post('/api/v1/admin/faces/reprocess').set(auth);
    expect(started.status).toBe(200);
    expect(started.headers.sunset).toBeDefined();

    const status = await request(server).get('/api/v1/admin/faces/reprocess').set(auth);
    expect(status.status).toBe(200);
    expect(status.headers.sunset).toBeDefined();

    const fresh = await request(server).get(`${RUNS}/faces`).set(auth);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.sunset).toBeUndefined();
  });
});
