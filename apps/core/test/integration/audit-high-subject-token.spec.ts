import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
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

/**
 * Regression tests for the subject-less-token findings (API security audit 2026-10-21,
 * "High" findings #1 and #2 — report: audit/report/api-audit-2026-10-21T11-15-24-888Z.md,
 * probes "B:token without a subject" and "B:subject-less token cannot read another user's
 * asset").
 *
 * #1 GET /api/v1/assets — a token without a subject is accepted as authenticated.
 * #2 GET /api/v1/assets/{id} — the same subject-less token reads another user's asset.
 *
 * Root cause: apps/core/src/auth/jwt-auth.guard.ts never requires `payload.sub` — line 141
 * only checks `typeof payload.iat !== 'number'`, and the lookup on line 148
 * (`findOne({ where: { id: payload.sub } })`) degrades to "the first row in users" because
 * TypeORM 0.3.31 ignores undefined where values, so the fail-closed check on line 154 never
 * fires and line 160 installs `req.user = { id: undefined }`. The ownership filter then drops
 * its own predicate: apps/core/src/common/asset-ownership.ts:14 does
 * `findOne({ where: { id, userId } })`, and with `userId === undefined` the row matches on id
 * alone — a cross-tenant read.
 *
 * These tests assert the SECURE behaviour and FAIL against the current code.
 */
describe('audit #1/#2: a token without a subject must not authenticate', () => {
  let t: ApiTestApp;

  beforeAll(async () => {
    // mockUser: null keeps the real JwtAuthGuard in place — the guard is what is under test
    t = await createApiTestApp({ mockUser: null });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(t);
  });

  beforeEach(async () => {
    await resetDb(t);
  });

  /**
   * Mints a token that is validly signed with the app's auth secret but carries NO `sub`
   * claim — the exact shape the audit probe used. The claim assertions keep the probe
   * self-checking: if the token ever grew a subject, the tests below would prove nothing.
   */
  const signSubjectLessToken = (email: string): string => {
    const jwt = t.app.get<JwtService>(JwtService);
    const token = jwt.sign({ email, role: 'user' }, { expiresIn: '15m' });

    const decoded = jwt.decode<Record<string, unknown> | null>(token);
    expect(decoded, 'the probe token must decode').not.toBeNull();
    expect(decoded?.sub, 'the probe token must carry NO sub claim').toBeUndefined();
    expect(() => {
      jwt.verify(token);
    }, 'the probe token must be validly signed').not.toThrow();

    return token;
  };

  it('#1 a token without a subject must not authenticate (GET /api/v1/assets)', async () => {
    // the victim must exist BEFORE the request: the guard's subject-less lookup resolves to
    // an arbitrary user row, so an empty users table would 401 for the wrong reason
    const victim = await seedUser(t);

    const token = signSubjectLessToken(victim.email);
    const res = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(token));

    expect
      .soft(res.status, 'finding #1: a subject-less token must not authenticate (401)')
      .toBe(401);
    const body = res.body as unknown as { items?: unknown[] };
    expect
      .soft(body?.items ?? [], 'finding #1: a subject-less token must not receive any asset')
      .toEqual([]);
  });

  it('#2 a subject-less token must not read another user’s asset (GET /api/v1/assets/{id})', async () => {
    const victim = await seedUser(t);
    const file = await seedFile(t, victim.id);
    const asset = await seedAsset(t, victim.id, file.id);

    const token = signSubjectLessToken(victim.email);
    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(token));

    expect
      .soft([401, 404], 'finding #2: a subject-less token must not read another user’s asset')
      .toContain(res.status);

    // belt and braces: a 200 with an empty body must not pass either — the victim row must
    // not leak through the response
    const raw = JSON.stringify(res.body ?? {});
    expect
      .soft(raw, 'finding #2: the response must not leak the victim asset id')
      .not.toContain(asset.id);
    expect
      .soft(raw, 'finding #2: the response must not leak the victim file id')
      .not.toContain(file.id);
    expect
      .soft(raw, 'finding #2: the response must not leak the victim email')
      .not.toContain(victim.email);
  });

  it('control: a normal user token lists the caller’s own assets', async () => {
    const user = await seedUser(t);
    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const res = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(token));
    expect(res.status, 'control: a normal user token lists its own assets').toBe(200);
    const body = res.body as unknown as { items?: { id: string }[]; total?: number };
    expect(body.total).toBe(1);
    expect(body.items?.map((i) => i.id)).toEqual([asset.id]);
  });

  it('control: a normal user token reads the caller’s own asset', async () => {
    const user = await seedUser(t);
    const file = await seedFile(t, user.id);
    const asset = await seedAsset(t, user.id, file.id);
    const token = t.signToken({ id: user.id, email: user.email, role: user.role });

    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(token));
    expect(res.status, 'control: a normal user token reads its own asset').toBe(200);
    const body = res.body as unknown as { id?: string; userId?: string };
    expect(body.id).toBe(asset.id);
    expect(body.userId).toBe(user.id);
  });

  it('control: user A’s token gets 404 (not 200) on user B’s asset', async () => {
    const a = await seedUser(t);
    const b = await seedUser(t);
    const fileB = await seedFile(t, b.id);
    const assetB = await seedAsset(t, b.id, fileB.id);
    const tokenA = t.signToken({ id: a.id, email: a.email, role: a.role });

    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${assetB.id}`)
      .set(t.authHeader(tokenA));
    expect(res.status, 'control: another user’s asset stays 404').toBe(404);
  });
});
