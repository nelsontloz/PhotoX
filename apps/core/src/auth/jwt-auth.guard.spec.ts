import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { ACCESS_COOKIE } from './auth-cookie'
import { JwtAuthGuard, requireUserId } from './jwt-auth.guard'

const TEST_SECRET = 'test-secret-0123456789abcdef0123456789'
// phase-2: the guard verifies against explicit env secrets (not the injected JwtService
// default), so the env user secret must match this spec's signing secret
process.env.AUTH_TOKEN_SECRET = TEST_SECRET
process.env.WORKER_JWT_SECRET = 'worker-unit-test-secret-9f8e7d6c5b4a3210'
const jwt = new JwtService({ secret: TEST_SECRET })
const guard = new JwtAuthGuard(jwt)

function tokenFor(role: 'user' | 'admin' = 'user'): string {
  return jwt.sign({ sub: 'u1', email: 'u@example.com', role })
}

function workerTokenFor(role: 'user' | 'admin', sub = 'worker-service'): string {
  return jwt.sign({ sub, email: 'worker@internal', role, act: { sub: 'worker-service' } })
}

const cookieHeader = (token: string): Record<string, string> => ({
  cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}`,
})

type CookieArgs = [name: string, value: string, options: { maxAge?: number; httpOnly?: boolean }]

function testContext(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  query: Record<string, unknown> = {},
): { context: ExecutionContext; req: Request; cookie: ReturnType<typeof vi.fn> } {
  const req = { method, path, headers, query } as unknown as Request
  const cookie = vi.fn<(...args: CookieArgs) => void>()
  const res = { cookie, clearCookie: vi.fn() }
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext
  return { context, req, cookie }
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
]

describe('JwtAuthGuard', () => {
  it.each(CASES)('%s %s → open=%s', async (method, path, expected) => {
    const { context } = testContext(method, path)
    if (expected) {
      await expect(guard.canActivate(context)).resolves.toBe(true)
    } else {
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException)
    }
  })

  it('rejects protected routes without a token with 401', async () => {
    try {
      await guard.canActivate(testContext('GET', '/api/v1/assets').context)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException)
      expect((err as UnauthorizedException).getStatus()).toBe(401)
      expect((err as UnauthorizedException).getResponse()).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      })
    }
  })

  it('rejects spoofed x-user-* headers alone', async () => {
    const spoofed = {
      'x-user-id': 'u1',
      'x-user-email': 'u@example.com',
      'x-user-role': 'admin',
    }
    await expect(
      guard.canActivate(testContext('GET', '/api/v1/admin/users', spoofed).context),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('rejects invalid tokens with 401', async () => {
    await expect(
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: 'Bearer not-a-token' }).context,
      ),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('rejects tokens with an unknown role with 401', async () => {
    const forged = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'root' })
    await expect(
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: `Bearer ${forged}` }).context,
      ),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('rejects expired tokens with 401', async () => {
    const expired = jwt.sign(
      { sub: 'u1', email: 'u@example.com', role: 'user' },
      {
        expiresIn: '-1h',
      },
    )
    await expect(
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: `Bearer ${expired}` }).context,
      ),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('attaches identity from a valid token', async () => {
    const { context, req } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
    })
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(req.user).toEqual({ id: 'u1', email: 'u@example.com', role: 'user' })
  })

  it('ignores spoofed x-user-* headers when a valid token is present', async () => {
    const { context, req } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
      'x-user-id': 'someone-else',
      'x-user-email': 'admin@example.com',
      'x-user-role': 'admin',
    })
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(req.user).toEqual({ id: 'u1', email: 'u@example.com', role: 'user' })
  })

  it('authenticates via the HttpOnly access cookie alone', async () => {
    const { context, req } = testContext('GET', '/api/v1/files/f1/stream', cookieHeader(tokenFor()))
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(req.user).toEqual({ id: 'u1', email: 'u@example.com', role: 'user' })
  })

  it('prefers the bearer token over a conflicting cookie', async () => {
    const { context, req } = testContext('GET', '/api/v1/assets', {
      ...cookieHeader(tokenFor()),
      authorization: `Bearer ${tokenFor('admin')}`,
    })
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(req.user).toEqual({ id: 'u1', email: 'u@example.com', role: 'admin' })
  })

  it('rejects an invalid cookie when no bearer token is present', async () => {
    await expect(
      guard.canActivate(testContext('GET', '/api/v1/assets', cookieHeader('not-a-token')).context),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('does not fall back to a valid cookie when the bearer token is invalid', async () => {
    const { context } = testContext('GET', '/api/v1/assets', {
      ...cookieHeader(tokenFor()),
      authorization: 'Bearer not-a-token',
    })
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException)
  })

  it('renews the access cookie when the token is past half of its own ttl', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      const stale = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'user' }, { expiresIn: 30 })
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'))
      const { context, cookie } = testContext('GET', '/api/v1/assets', cookieHeader(stale))

      await expect(guard.canActivate(context)).resolves.toBe(true)
      expect(cookie).toHaveBeenCalledWith(
        ACCESS_COOKIE,
        expect.any(String),
        expect.objectContaining({ maxAge: 30_000, httpOnly: true }),
      )
      const [, fresh] = cookie.mock.calls[0] as CookieArgs
      expect(fresh).not.toBe(stale)
      expect(jwt.verify(fresh)).toMatchObject({ sub: 'u1', email: 'u@example.com', role: 'user' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not renew a fresh cookie token', async () => {
    const token = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'user' }, { expiresIn: 3600 })
    const { context, cookie } = testContext('GET', '/api/v1/assets', cookieHeader(token))
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(cookie).not.toHaveBeenCalled()
  })

  it('preserves the act claim when renewing a cookie-borne worker token', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      const stale = jwt.sign(
        { sub: 'u1', email: 'u@example.com', role: 'admin', act: { sub: 'worker-service' } },
        { expiresIn: 30 },
      )
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'))
      const { context, cookie } = testContext('GET', '/worker/assets/a1', cookieHeader(stale))

      await expect(guard.canActivate(context)).resolves.toBe(true)
      const [, fresh] = cookie.mock.calls[0] as CookieArgs
      expect(fresh).not.toBe(stale)
      expect(jwt.verify(fresh)).toMatchObject({
        sub: 'u1',
        role: 'admin',
        // dropping act would turn this into a plain admin token, escaping the act-only rules
        act: { sub: 'worker-service' },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('heals a stale cookie to the bearer identity when the bearer wins', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      const staleCookie = jwt.sign(
        { sub: 'cookie-user', email: 'cookie@example.com', role: 'user' },
        { expiresIn: 30 },
      )
      const bearer = jwt.sign(
        { sub: 'bearer-user', email: 'bearer@example.com', role: 'user' },
        { expiresIn: 30 },
      )
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'))
      const { context, req, cookie } = testContext('GET', '/api/v1/assets', {
        ...cookieHeader(staleCookie),
        authorization: `Bearer ${bearer}`,
      })

      await expect(guard.canActivate(context)).resolves.toBe(true)
      expect(req.user).toEqual({ id: 'bearer-user', email: 'bearer@example.com', role: 'user' })
      expect(cookie).toHaveBeenCalledWith(
        ACCESS_COOKIE,
        expect.any(String),
        expect.objectContaining({ maxAge: 30_000, httpOnly: true }),
      )
      // the renewal heals the jar to the identity that actually authenticated, not the stale cookie's
      const [, fresh] = cookie.mock.calls[0] as CookieArgs
      expect(jwt.verify(fresh)).toMatchObject({ sub: 'bearer-user' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('heals a stale cookie to a worker bearer identity with act preserved', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      const staleCookie = jwt.sign(
        { sub: 'cookie-user', email: 'cookie@example.com', role: 'user' },
        { expiresIn: 30 },
      )
      const bearer = jwt.sign(
        { sub: 'u1', email: 'worker@internal', role: 'admin', act: { sub: 'worker-service' } },
        { expiresIn: 30 },
      )
      vi.setSystemTime(new Date('2030-01-01T00:00:20Z'))
      const { context, cookie } = testContext('GET', '/worker/assets/a1', {
        ...cookieHeader(staleCookie),
        authorization: `Bearer ${bearer}`,
      })

      await expect(guard.canActivate(context)).resolves.toBe(true)
      const [, fresh] = cookie.mock.calls[0] as CookieArgs
      expect(jwt.verify(fresh)).toMatchObject({
        sub: 'u1',
        act: { sub: 'worker-service' },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not renew a bearer token', async () => {
    const token = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'user' }, { expiresIn: 10 })
    const { context, cookie } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${token}`,
    })
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(cookie).not.toHaveBeenCalled()
  })

  it('rejects non-admin on /api/v1/admin/* with 403', async () => {
    try {
      await guard.canActivate(
        testContext('GET', '/api/v1/admin/users', {
          authorization: `Bearer ${tokenFor()}`,
        }).context,
      )
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException)
      expect((err as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        message: 'Admin only',
        error: 'Forbidden',
      })
    }
  })

  it('lets admins through on /api/v1/admin/*', async () => {
    const { context, req } = testContext('GET', '/api/v1/admin/users', {
      authorization: `Bearer ${tokenFor('admin')}`,
    })
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(req.user?.role).toBe('admin')
  })

  it('lets worker-actor admin tokens through on worker routes and the act list read', async () => {
    const auth = { authorization: `Bearer ${workerTokenFor('admin')}` }
    const pass = (method: string, path: string, query: Record<string, unknown> = {}) =>
      guard.canActivate(testContext(method, path, auth, query).context)
    await expect(pass('GET', '/worker/assets/a1')).resolves.toBe(true)
    await expect(pass('PATCH', '/worker/assets/a1/metadata')).resolves.toBe(true)
    await expect(pass('GET', '/api/v1/assets', { ids: 'a1,b2' })).resolves.toBe(true)
  })

  it('rejects worker-actor tokens outside the worker surface with 403', async () => {
    const adminAuth = { authorization: `Bearer ${workerTokenFor('admin')}` }
    const userAuth = { authorization: `Bearer ${workerTokenFor('user', 'u1')}` }
    const deny = (method: string, path: string, headers: Record<string, string>) =>
      expect(guard.canActivate(testContext(method, path, headers).context)).rejects.toThrow(
        ForbiddenException,
      )
    await deny('GET', '/api/v1/admin/face-detection', adminAuth)
    await deny('DELETE', '/api/v1/admin/files/f1', adminAuth)
    await deny('POST', '/api/v1/admin/cleanup-orphans/run', adminAuth)
    await deny('GET', '/api/v1/assets/a1', userAuth)
    await deny('PATCH', '/api/v1/assets/a1/metadata', userAuth)
    await deny('GET', '/api/v1/files/f1/stream', userAuth)
    await deny('GET', '/api/v1/assets', userAuth)
  })

  it('rejects worker-actor admin tokens on non-allowlisted admin routes with 403', async () => {
    const auth = { authorization: `Bearer ${workerTokenFor('admin')}` }
    const deny = (method: string, path: string) =>
      expect(guard.canActivate(testContext(method, path, auth).context)).rejects.toThrow(
        ForbiddenException,
      )
    await deny('GET', '/api/v1/admin/users')
    await deny('GET', '/api/v1/admin/face-detection')
  })

  it('rejects plain tokens on worker routes with 403', async () => {
    const auth = { authorization: `Bearer ${tokenFor()}` }
    await expect(
      guard.canActivate(testContext('GET', '/worker/assets/a1', auth).context),
    ).rejects.toThrow(ForbiddenException)
  })

  it('rejects worker-only metadata fields from non-act callers with 403', async () => {
    const req = {
      method: 'PATCH',
      path: '/api/v1/assets/a1/metadata',
      headers: { authorization: `Bearer ${tokenFor()}` },
      body: { width: 100 },
    } as unknown as Request
    const cookie = vi.fn()
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ cookie }) }),
    } as unknown as ExecutionContext
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException)
  })

  it('lets non-admins through on normal routes', async () => {
    const { context } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
    })
    await expect(guard.canActivate(context)).resolves.toBe(true)
  })
})

describe('requireUserId', () => {
  const contextWith = (user?: { id: string }) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext

  it('returns the verified user id', () => {
    expect(requireUserId(contextWith({ id: 'u1' }))).toBe('u1')
  })

  it('throws 401 when the request has no verified user', () => {
    expect(() => requireUserId(contextWith())).toThrow(UnauthorizedException)
  })
})
