import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { JwtAuthGuard } from './jwt-auth.guard'

const TEST_SECRET = 'test-secret-0123456789abcdef0123456789'
const jwt = new JwtService({ secret: TEST_SECRET })
const guard = new JwtAuthGuard(jwt)

function tokenFor(role: 'user' | 'admin' = 'user'): string {
  return jwt.sign({ sub: 'u1', email: 'u@example.com', role })
}

function workerTokenFor(role: 'user' | 'admin', sub = 'worker-service'): string {
  return jwt.sign({ sub, email: 'worker@internal', role, act: { sub: 'worker-service' } })
}

function testContext(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): { context: ExecutionContext; req: Request } {
  const req = { method, path, headers } as unknown as Request
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
  return { context, req }
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
  ['GET', '/api/v1/files/f1/stream', true],
  ['POST', '/api/v1/files/f1/stream', false],
  ['GET', '/api/v1/files/a/b/stream', false],
  ['GET', '/api/v1/files//stream', false],
  ['GET', '/api/v1/assets', false],
  ['GET', '/api/v1/admin/users', false],
  ['DELETE', '/api/v1/files/f1/stream', false],
]

describe('JwtAuthGuard', () => {
  it.each(CASES)('%s %s → open=%s', (method, path, expected) => {
    if (expected) {
      expect(guard.canActivate(testContext(method, path).context)).toBe(true)
    } else {
      expect(() => guard.canActivate(testContext(method, path).context)).toThrow(
        UnauthorizedException,
      )
    }
  })

  it('rejects protected routes without a token with 401', () => {
    try {
      guard.canActivate(testContext('GET', '/api/v1/assets').context)
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

  it('rejects spoofed x-user-* headers alone', () => {
    const spoofed = {
      'x-user-id': 'u1',
      'x-user-email': 'u@example.com',
      'x-user-role': 'admin',
    }
    expect(() =>
      guard.canActivate(testContext('GET', '/api/v1/admin/users', spoofed).context),
    ).toThrow(UnauthorizedException)
  })

  it('rejects invalid tokens with 401', () => {
    expect(() =>
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: 'Bearer not-a-token' }).context,
      ),
    ).toThrow(UnauthorizedException)
  })

  it('rejects tokens with an unknown role with 401', () => {
    const forged = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'root' })
    expect(() =>
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: `Bearer ${forged}` }).context,
      ),
    ).toThrow(UnauthorizedException)
  })

  it('rejects expired tokens with 401', () => {
    const expired = jwt.sign(
      { sub: 'u1', email: 'u@example.com', role: 'user' },
      {
        expiresIn: '-1h',
      },
    )
    expect(() =>
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: `Bearer ${expired}` }).context,
      ),
    ).toThrow(UnauthorizedException)
  })

  it('attaches identity from a valid token', () => {
    const { context, req } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
    })
    expect(guard.canActivate(context)).toBe(true)
    expect(req.user).toEqual({ id: 'u1', email: 'u@example.com', role: 'user' })
  })

  it('ignores spoofed x-user-* headers when a valid token is present', () => {
    const { context, req } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
      'x-user-id': 'someone-else',
      'x-user-email': 'admin@example.com',
      'x-user-role': 'admin',
    })
    expect(guard.canActivate(context)).toBe(true)
    expect(req.user).toEqual({ id: 'u1', email: 'u@example.com', role: 'user' })
  })

  it('rejects non-admin on /api/v1/admin/* with 403', () => {
    try {
      guard.canActivate(
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

  it('lets admins through on /api/v1/admin/*', () => {
    const { context, req } = testContext('GET', '/api/v1/admin/users', {
      authorization: `Bearer ${tokenFor('admin')}`,
    })
    expect(guard.canActivate(context)).toBe(true)
    expect(req.user?.role).toBe('admin')
  })

  it('lets worker-actor admin tokens through on the allowlist', () => {
    const auth = { authorization: `Bearer ${workerTokenFor('admin')}` }
    const pass = (method: string, path: string) =>
      guard.canActivate(testContext(method, path, auth).context)
    expect(pass('DELETE', '/api/v1/admin/files/f1')).toBe(true)
    expect(pass('POST', '/api/v1/admin/cleanup-orphans/run')).toBe(true)
    expect(pass('GET', '/api/v1/admin/face-detection')).toBe(true)
  })

  it('rejects worker-actor admin tokens on non-allowlisted admin routes with 403', () => {
    const auth = { authorization: `Bearer ${workerTokenFor('admin')}` }
    const deny = (method: string, path: string) =>
      expect(() => guard.canActivate(testContext(method, path, auth).context)).toThrow(
        ForbiddenException,
      )
    deny('GET', '/api/v1/admin/users')
    deny('PUT', '/api/v1/admin/face-detection')
  })

  it('lets worker-actor user tokens through on user routes', () => {
    const { context } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${workerTokenFor('user', 'u1')}`,
    })
    expect(guard.canActivate(context)).toBe(true)
  })

  it('lets non-admins through on normal routes', () => {
    const { context } = testContext('GET', '/api/v1/assets', {
      authorization: `Bearer ${tokenFor()}`,
    })
    expect(guard.canActivate(context)).toBe(true)
  })
})
