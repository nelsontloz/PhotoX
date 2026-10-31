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
import { BullMqService } from '../../src/queue/bullmq.service';

/**
 * Regression tests for the two HIGH findings of the API security audit of 2026-10-21
 * (audit/report/api-audit-2026-10-21T11-15-24-888Z.md, "High" section).
 *
 * These tests assert the SECURE behaviour and currently FAIL against the current code.
 *
 * #3 — "Service token reads another user's file bytes through the ids exception"
 *   Route: GET /api/v1/files/{fileId}/stream?ids=x
 *   A delegated service token (RFC 8693 `act` claim) may reach a non-worker route only when
 *   the request carries a non-empty `ids` query parameter: apps/core/src/auth/jwt-auth.guard.ts:49-53
 *   defines `isActListRead(req)` as "the request has a non-empty `ids` query parameter", and
 *   line 168 uses it to gate the act token
 *   (`if (payload.act && !isWorkerRoute(path) && !isActListRead(req)) throw new ForbiddenException(...)`).
 *   The exception is keyed on the query-parameter SHAPE, not on the route, so any route carrying
 *   ?ids= becomes reachable by a service token — including routes that serve raw bytes, and with no
 *   X-Job-Signature job binding attached. The stream route is scoped to the token's own subject
 *   (apps/core/src/files/user/user-files.controller.ts:85-98
 *   `stream(fileId, ..., userId)` -> `serveFileBytes(req, res, this.userFilesService, userId, fileId)`),
 *   so a service token whose `sub` is the victim reads the victim's bytes.
 *
 * #4 — "Logout is a no-op when no refresh token is presented"
 *   Route: POST /api/v1/auth/logout
 *   The session floor (users.tokensValidAfter) is raised only when a refresh token is supplied:
 *   apps/core/src/users/auth.controller.ts:116-117 does `if (raw) await this.authService.logout(raw)`,
 *   and apps/core/src/users/auth.service.ts:123-131 returns early (`if (!row) return`) for an
 *   unknown/absent token. A bearer-only client (or an attacker holding only an access token) can
 *   therefore never terminate its own session, and "log out everywhere" leaves every previously
 *   issued access token alive. The guard enforces the floor at
 *   apps/core/src/auth/jwt-auth.guard.ts:156
 *   (`if (row?.tokensValidAfter && Math.floor(row.tokensValidAfter.getTime() / 1000) > payload.iat) throw new UnauthorizedException()`).
 *
 * Note: the floor compares at one-second granularity (a separate MEDIUM finding, out of scope
 * here) — the logout tests therefore cross a second boundary before logging out, so what they
 * assert is the missing floor bump and not the same-second window.
 */

interface AuthBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: 'user' | 'admin' };
}

const PASSWORD = 'correcthorsebattery';
const BYTE_MARKER = 'PHOTOX-AUDIT-BYTES-MARKER';

/** Raw response payload as text — the stream route answers with bytes, the others with JSON. */
const bodyText = (res: { body?: unknown; text?: string }): string => {
  if (Buffer.isBuffer(res.body)) return res.body.toString('utf8');
  if (typeof res.body === 'string') return res.body;
  if (res.body !== undefined) return JSON.stringify(res.body);
  return res.text ?? '';
};

describe('audit High #3/#4: service-token scope and logout revocation (expect secure, currently insecure)', () => {
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
    // flush the Redis rate limiter so the register limit (RATE_LIMIT_REGISTER, 10/h) never
    // interferes with the auth flows below
    await t.app.get<BullMqService>(BullMqService).redis.flushdb();
  });

  const registerUser = async (email: string): Promise<AuthBody> => {
    const res = await request(apiServer(t))
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Test User' });
    expect(res.status, 'register must succeed').toBe(201);
    return res.body as AuthBody;
  };

  /**
   * The floor compares at one-second granularity while the token's `iat` is in seconds — wait
   * past a second boundary so the revocation asserted below is the missing floor bump and not
   * the (separate, out-of-scope) MEDIUM same-second window.
   */
  const crossSecondBoundary = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 2100));
  };

  it('#3 a service token cannot read another user’s file bytes through the ids exception', async () => {
    const victim = await seedUser(t);
    const file = await seedFile(t, victim.id, {
      bytes: Buffer.from(BYTE_MARKER),
      mimeType: 'application/octet-stream',
    });

    // a worker-signed actor token for the victim — the delegated service credential
    const serviceToken = t.signWorkerToken(
      { id: victim.id, email: victim.email, role: 'user' },
      { act: true },
    );

    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream?ids=x`)
      .set(t.authHeader(serviceToken));

    // soft first: the byte leak must be reported even though the status assertion fails first
    expect
      .soft(bodyText(res), 'finding #3: the response must not carry the victim’s file bytes')
      .not.toContain(BYTE_MARKER);
    expect(res.status, 'finding #3: a service token must not reach a byte-serving route').not.toBe(
      200,
    );
    expect([401, 403], 'finding #3: a service token must not reach a byte-serving route').toContain(
      res.status,
    );
  });

  it('#3 control: the worker ranking list read stays reachable for a service token', async () => {
    // guards against an over-broad fix: the ids list read is the ONE route the service token
    // exception exists for (worker ranking fetches), so it must keep working
    const victim = await seedUser(t);
    const file = await seedFile(t, victim.id);
    const asset = await seedAsset(t, victim.id, file.id);

    const serviceToken = t.signWorkerToken(
      { id: victim.id, email: victim.email, role: 'user' },
      { act: true },
    );

    const res = await request(apiServer(t))
      .get(`/api/v1/assets?ids=${asset.id}`)
      .set(t.authHeader(serviceToken));
    expect(res.status, 'the intended ids list route must stay reachable for a service token').toBe(
      200,
    );
    const items = (res.body as { items?: { id?: string }[] }).items ?? [];
    expect(items[0]?.id, 'the ids list read must return the requested asset').toBe(asset.id);
  });

  it('#3 control: the owner’s own token still streams their file', async () => {
    // guards against an over-broad fix: the byte route must keep working for its owner
    const victim = await seedUser(t);
    const file = await seedFile(t, victim.id, {
      bytes: Buffer.from(BYTE_MARKER),
      mimeType: 'application/octet-stream',
    });

    const own = t.authHeader(t.signToken({ id: victim.id, email: victim.email, role: 'user' }));
    const res = await request(apiServer(t)).get(`/api/v1/files/${file.id}/stream`).set(own);
    expect(res.status, 'the owner must still stream their own file').toBe(200);
    expect(bodyText(res), 'the owner must still read their own bytes').toContain(BYTE_MARKER);
  });

  it('#4 logout without a refresh token must still revoke the session', async () => {
    const { accessToken } = await registerUser('audit-logout@example.com');
    await crossSecondBoundary();

    // empty body, no cookies — a bearer-only client asking to end its own session
    const logout = await request(apiServer(t))
      .post('/api/v1/auth/logout')
      .set(t.authHeader(accessToken))
      .send({});
    expect(logout.status, 'logout must answer 204').toBe(204);

    const after = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(accessToken));
    expect(after.status, 'finding #4: logout without a refresh token must revoke the session').toBe(
      401,
    );
  });

  it('#4 control: logout with a refresh token revokes the access token', async () => {
    // guards against an over-broad fix: the refresh-token path must keep revoking
    const { accessToken, refreshToken } = await registerUser('audit-logout-refresh@example.com');
    await crossSecondBoundary();

    const logout = await request(apiServer(t))
      .post('/api/v1/auth/logout')
      .set(t.authHeader(accessToken))
      .send({ refreshToken });
    expect(logout.status, 'logout must answer 204').toBe(204);

    const after = await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(accessToken));
    expect(after.status, 'logout with a refresh token must revoke the access token').toBe(401);
  });
});
