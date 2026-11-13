import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { ACCESS_COOKIE } from './auth-cookie';
import { JwtAuthGuard, requireUserId } from './jwt-auth.guard';

const TEST_SECRET = 'test-secret-0123456789abcdef0123456789';
// real subjects are uuids: a non-uuid sub cannot identify an account, so the guard
// canonicalizes it (`worker-service` -> nil uuid). Keep these fixtures representative.
const USER_ID = '11111111-1111-4111-8111-111111111111';
const BEARER_ID = '22222222-2222-4222-8222-222222222222';
// phase-2: the guard verifies against explicit env secrets (not the injected JwtService
// default), so the env user secret must match this spec's signing secret
process.env.AUTH_TOKEN_SECRET = TEST_SECRET;
const WORKER_SECRET = 'worker-unit-test-secret-9f8e7d6c5b4a3210';
process.env.WORKER_JWT_SECRET = WORKER_SECRET;
const jwt = new JwtService({ secret: TEST_SECRET });
const guard = new JwtAuthGuard(jwt);

const jobSig = (sub: string, scope: string): string =>
  createHmac('sha256', WORKER_SECRET).update(`${sub}:${scope}`).digest('hex');

function tokenFor(role: 'user' | 'admin' = 'user'): string {
  return jwt.sign({ sub: USER_ID, email: 'u@example.com', role });
}

function workerTokenFor(role: 'user' | 'admin', sub = 'worker-service'): string {
  return jwt.sign({ sub, email: 'worker@internal', role, act: { sub: 'worker-service' } });
}

const cookieHeader = (token: string): Record<string, string> => ({
  cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}`,
});

type CookieArgs = [name: string, value: string, options: { maxAge?: number; httpOnly?: boolean }];

function testContext(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  query: Record<string, unknown> = {},
): { context: ExecutionContext; req: Request; cookie: ReturnType<typeof vi.fn> } {
  const req = { method, path, headers, query } as unknown as Request;
  const cookie = vi.fn<(...args: CookieArgs) => void>();
  const res = { cookie, clearCookie: vi.fn() };
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { context, req, cookie };
}

// ponytail: open-route parity table — this pins the API's public surface;
// any row change is an access-rule change, make it deliberately
const CASES: [string, string, boolean][] = [
  ['GET', '/docs', true],
  ['POST', '/docs', true],
  ['GET', '/docs-json', true],
  ['GET', '/docs/extra', true],
  ['GET', '/health', true],
  ['GET', '/health/extra', false],
  ['GET', '/api/v1/auth', true],
  ['POST', '/api/v1/auth/login', true],
  ['POST', '/api/v1/auth/refresh', true],
  ['GET', '/api/v1/authentication', false],
  ['GET', '/api/share', true],
  ['POST', '/api/share/abc', true],
  ['GET', '/api/share/abc', true],
  ['GET', '/api/share/abc/stream', true],
  ['GET', '/api/share/abc/assets', true],
  ['GET', '/api/share/abc/assets/a1/stream', true],
  ['GET', '/api/v1/files/f1/stream', false],
  ['POST', '/api/v1/files/f1/stream', false],
  ['GET', '/api/v1/files/a/b/stream', false],
  ['GET', '/api/v1/files//stream', false],
  ['GET', '/api/v1/assets', false],
  ['GET', '/api/v1/admin/users', false],
  ['DELETE', '/api/v1/files/f1/stream', false],
];

describe('JwtAuthGuard', () => {
  it.each(CASES)('%s %s → open=%s', async (method, path, expected) => {
    const { context } = testContext(method, path);
    if (expected) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    } else {
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    }
  });

  it('rejects protected routes without a token with 401', async () => {
    try {
      await guard.canActivate(testContext('GET', '/api/v1/assets').context);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getStatus()).toBe(401);
      expect((err as UnauthorizedException).getResponse()).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
    }
  });

  it('rejects spoofed x-user-* headers alone', async () => {
    const spoofed = {
      'x-user-id': USER_ID,
      'x-user-email': 'u@example.com',
      'x-user-role': 'admin',
    };
    await expect(
      guard.canActivate(testContext('GET', '/api/v1/admin/users', spoofed).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects invalid tokens with 401', async () => {
    await expect(
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: 'Bearer not-a-token' }).context,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens with an unknown role with 401', async () => {
    const forged = jwt.sign({ sub: USER_ID, email: 'u@example.com', role: 'root' });
    await expect(
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: `Bearer ${forged}` }).context,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects expired tokens with 401', async () => {
    const expired = jwt.sign(
      { sub: USER_ID, email: 'u@example.com', role: 'user' },
      {
        expiresIn: '-1h',
      },
    );
    await expect(
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: `Bearer ${expired}` }).context,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('attaches identity from a valid token', async () => {
    const { context, req } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: USER_ID, email: 'u@example.com', role: 'user' });
  });

  it('ignores spoofed x-user-* headers when a valid token is present', async () => {
    const { context, req } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
      'x-user-id': 'someone-else',
      'x-user-email': 'admin@example.com',
      'x-user-role': 'admin',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: USER_ID, email: 'u@example.com', role: 'user' });
  });

  it('authenticates via the HttpOnly access cookie alone', async () => {
    const { context, req } = testContext(
      'GET',
      '/api/v1/files/f1/stream',
      cookieHeader(tokenFor()),
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: USER_ID, email: 'u@example.com', role: 'user' });
  });

  it('prefers the bearer token over a conflicting cookie', async () => {
    const { context, req } = testContext('GET', '/api/v1/assets', {
      ...cookieHeader(tokenFor()),
      authorization: `Bearer ${tokenFor('admin')}`,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: USER_ID, email: 'u@example.com', role: 'admin' });
  });

  it('rejects an invalid cookie when no bearer token is present', async () => {
    await expect(
      guard.canActivate(testContext('GET', '/api/v1/assets', cookieHeader('not-a-token')).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('does not fall back to a valid cookie when the bearer token is invalid', async () => {
    const { context } = testContext('GET', '/api/v1/assets', {
      ...cookieHeader(tokenFor()),
      authorization: 'Bearer not-a-token',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('renews the access cookie when the token is past half of its own ttl', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const stale = jwt.sign(
        { sub: USER_ID, email: 'u@example.com', role: 'user' },
        { expiresIn: 30 },
      );
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'));
      const { context, cookie } = testContext('GET', '/api/v1/assets', cookieHeader(stale));

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(cookie).toHaveBeenCalledWith(
        ACCESS_COOKIE,
        expect.any(String),
        expect.objectContaining({ maxAge: 30_000, httpOnly: true }),
      );
      const [, fresh] = cookie.mock.calls[0] as CookieArgs;
      expect(fresh).not.toBe(stale);
      expect(jwt.verify(fresh)).toMatchObject({
        sub: USER_ID,
        email: 'u@example.com',
        role: 'user',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a token past the 7-day absolute session cap, bearer or cookie', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const dead = jwt.sign(
        {
          sub: USER_ID,
          email: 'u@example.com',
          role: 'user',
          sst: Math.floor(Date.now() / 1000) - 8 * 24 * 3600,
        },
        { expiresIn: 30 },
      );
      // past half-TTL, so the sliding renewal would otherwise keep the session alive forever
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'));
      const { context, cookie } = testContext('GET', '/api/v1/assets', cookieHeader(dead));

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(cookie).not.toHaveBeenCalled();
      // the same token replayed as a Bearer header must not bypass the cap
      await expect(
        guard.canActivate(
          testContext('GET', '/api/v1/assets', { authorization: `Bearer ${dead}` }).context,
        ),
      ).rejects.toThrow(UnauthorizedException);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not renew a fresh cookie token', async () => {
    const token = jwt.sign(
      { sub: USER_ID, email: 'u@example.com', role: 'user' },
      { expiresIn: 3600 },
    );
    const { context, cookie } = testContext('GET', '/api/v1/assets', cookieHeader(token));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(cookie).not.toHaveBeenCalled();
  });

  it('never re-mints a cookie from an act token', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const stale = jwt.sign(
        { sub: USER_ID, email: 'u@example.com', role: 'admin', act: { sub: 'worker-service' } },
        { expiresIn: 30 },
      );
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'));
      // the act-allowed list read keeps the token reachable outside the worker surface
      const { context, cookie } = testContext('GET', '/api/v1/assets', cookieHeader(stale), {
        ids: 'a1',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      // an act token is a job credential, not a browser session — no renewable cookie
      expect(cookie).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('heals a stale cookie to the bearer identity when the bearer wins', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const staleCookie = jwt.sign(
        { sub: 'cookie-user', email: 'cookie@example.com', role: 'user' },
        { expiresIn: 30 },
      );
      const bearer = jwt.sign(
        { sub: BEARER_ID, email: 'bearer@example.com', role: 'user' },
        { expiresIn: 30 },
      );
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'));
      const { context, req, cookie } = testContext('GET', '/api/v1/assets', {
        ...cookieHeader(staleCookie),
        authorization: `Bearer ${bearer}`,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(req.user).toEqual({ id: BEARER_ID, email: 'bearer@example.com', role: 'user' });
      expect(cookie).toHaveBeenCalledWith(
        ACCESS_COOKIE,
        expect.any(String),
        expect.objectContaining({ maxAge: 30_000, httpOnly: true }),
      );
      // the renewal heals the jar to the identity that actually authenticated, not the stale cookie's
      const [, fresh] = cookie.mock.calls[0] as CookieArgs;
      expect(jwt.verify(fresh)).toMatchObject({ sub: BEARER_ID });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-mint the cookie when the bearer is an act token', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const staleCookie = jwt.sign(
        { sub: 'cookie-user', email: 'cookie@example.com', role: 'user' },
        { expiresIn: 30 },
      );
      const bearer = jwt.sign(
        { sub: USER_ID, email: 'worker@internal', role: 'admin', act: { sub: 'worker-service' } },
        { expiresIn: 30 },
      );
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'));
      const { context, cookie } = testContext(
        'GET',
        '/api/v1/assets',
        {
          ...cookieHeader(staleCookie),
          authorization: `Bearer ${bearer}`,
        },
        { ids: 'a1' },
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(cookie).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not renew a bearer token', async () => {
    const token = jwt.sign(
      { sub: USER_ID, email: 'u@example.com', role: 'user' },
      { expiresIn: 10 },
    );
    const { context, cookie } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${token}`,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(cookie).not.toHaveBeenCalled();
  });

  it('rejects non-admin on /api/v1/admin/* with 403', async () => {
    try {
      await guard.canActivate(
        testContext('GET', '/api/v1/admin/users', {
          authorization: `Bearer ${tokenFor()}`,
        }).context,
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        message: 'Admin only',
        error: 'Forbidden',
      });
    }
  });

  it('lets admins through on /api/v1/admin/*', async () => {
    const { context, req } = testContext('GET', '/api/v1/admin/users', {
      authorization: `Bearer ${tokenFor('admin')}`,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user?.role).toBe('admin');
  });

  it('lets worker-actor admin tokens through on worker routes and the act list read', async () => {
    // the unit context carries no route params, so the sub is the only derivable scope
    const auth = {
      authorization: `Bearer ${workerTokenFor('admin')}`,
      'x-job-signature': jobSig('worker-service', 'worker-service'),
    };
    const pass = (method: string, path: string, query: Record<string, unknown> = {}) =>
      guard.canActivate(testContext(method, path, auth, query).context);
    await expect(pass('GET', '/worker/assets/a1')).resolves.toBe(true);
    await expect(pass('PATCH', '/worker/assets/a1/metadata')).resolves.toBe(true);
    await expect(pass('GET', '/api/v1/assets', { ids: 'a1,b2' })).resolves.toBe(true);
  });

  it('rejects worker-actor tokens outside the worker surface with 403', async () => {
    const adminAuth = { authorization: `Bearer ${workerTokenFor('admin')}` };
    const userAuth = { authorization: `Bearer ${workerTokenFor('user', USER_ID)}` };
    const deny = (method: string, path: string, headers: Record<string, string>) =>
      expect(guard.canActivate(testContext(method, path, headers).context)).rejects.toThrow(
        ForbiddenException,
      );
    await deny('GET', '/api/v1/admin/face-detection', adminAuth);
    await deny('DELETE', '/api/v1/admin/files/f1', adminAuth);
    await deny('POST', '/api/v1/admin/cleanup-orphans/run', adminAuth);
    await deny('GET', '/api/v1/assets/a1', userAuth);
    await deny('PATCH', '/api/v1/assets/a1', userAuth);
    await deny('GET', '/api/v1/files/f1/stream', userAuth);
    await deny('GET', '/api/v1/assets', userAuth);
  });

  it('rejects worker-actor admin tokens on non-allowlisted admin routes with 403', async () => {
    const auth = { authorization: `Bearer ${workerTokenFor('admin')}` };
    const deny = (method: string, path: string) =>
      expect(guard.canActivate(testContext(method, path, auth).context)).rejects.toThrow(
        ForbiddenException,
      );
    await deny('GET', '/api/v1/admin/users');
    await deny('GET', '/api/v1/admin/face-detection');
  });

  it('rejects plain tokens on worker routes with 403', async () => {
    const auth = { authorization: `Bearer ${tokenFor()}` };
    await expect(
      guard.canActivate(testContext('GET', '/worker/assets/a1', auth).context),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets non-admins through on normal routes', async () => {
    const { context } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

// Once a signing secret leaks (see .env.example), the token's `role` claim is attacker-written:
// an ordinary account can mint `{sub: ownId, role: 'admin'}`. Admin access must therefore be
// decided by the stored users row, not by the claim.
describe('admin authorisation uses the stored account row', () => {
  function guardWithStoredRole(role: 'user' | 'admin'): JwtAuthGuard {
    const dataSource = {
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue({ id: USER_ID, role, tokensValidAfter: null }),
        exists: vi.fn().mockResolvedValue(true),
      }),
    } as unknown as DataSource;
    return new JwtAuthGuard(jwt, dataSource);
  }

  it('rejects an admin claim when the stored account is a user', async () => {
    await expect(
      guardWithStoredRole('user').canActivate(
        testContext('GET', '/api/v1/admin/users', {
          authorization: `Bearer ${tokenFor('admin')}`,
        }).context,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets a stored admin through and uses the stored role', async () => {
    const { context, req } = testContext('GET', '/api/v1/admin/users', {
      authorization: `Bearer ${tokenFor('admin')}`,
    });
    await expect(guardWithStoredRole('admin').canActivate(context)).resolves.toBe(true);
    expect(req.user?.role).toBe('admin');
  });
});

describe('requireUserId', () => {
  const contextWith = (user?: { id: string }) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

  it('returns the verified user id', () => {
    expect(requireUserId(contextWith({ id: USER_ID }))).toBe(USER_ID);
  });

  it('throws 401 when the request has no verified user', () => {
    expect(() => requireUserId(contextWith())).toThrow(UnauthorizedException);
  });
});
