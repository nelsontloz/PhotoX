import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { GatewayIdentityGuard } from './gateway-identity.guard'

function testContext(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): ExecutionContext {
  const req = { method, path, headers }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}

const IDENTITY = { 'x-user-id': 'u1', 'x-user-email': 'u@example.com', 'x-user-role': 'user' }

// ponytail: exact-match parity table duplicated in
// apps/gateway/src/auth/open-routes.spec.ts (no cross-app imports) —
// keep the tables identical; any row both sides disagree on fails here
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
  ['GET', '/api/v1/files/f1/stream', true],
  ['POST', '/api/v1/files/f1/stream', false],
  ['GET', '/api/v1/files/a/b/stream', false],
  ['GET', '/api/v1/files//stream', false],
  ['GET', '/api/v1/assets', false],
  ['GET', '/api/v1/admin/users', false],
  ['DELETE', '/api/v1/files/f1/stream', false],
]

describe('GatewayIdentityGuard', () => {
  const guard = new GatewayIdentityGuard()

  it.each(CASES)('%s %s → open=%s', (method, path, expected) => {
    if (expected) {
      expect(guard.canActivate(testContext(method, path))).toBe(true)
    } else {
      expect(() => guard.canActivate(testContext(method, path))).toThrow(UnauthorizedException)
    }
  })

  it('permits formerly-@Public routes without identity', () => {
    const open: [string, string][] = [
      ['GET', '/docs'],
      ['GET', '/docs-json'],
      ['GET', '/health'],
      ['POST', '/api/v1/auth/login'],
      ['GET', '/api/share/abc'],
      ['GET', '/api/share/abc/stream'],
      ['GET', '/api/v1/files/f1/stream'],
    ]
    for (const [method, path] of open) {
      expect(guard.canActivate(testContext(method, path))).toBe(true)
    }
  })

  it('ignores Bearer and 401s with core error shape when identity is missing', () => {
    const cases: Record<string, string>[] = [{}, { authorization: 'Bearer valid-looking' }]
    for (const headers of cases) {
      try {
        guard.canActivate(testContext('GET', '/api/v1/assets', headers))
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        expect((err as UnauthorizedException).getStatus()).toBe(401)
        expect((err as UnauthorizedException).getResponse()).toEqual({
          statusCode: 401,
          message: 'Unauthorized',
        })
      }
    }
  })

  it('populates req.user from x-user-* headers', () => {
    const req: {
      method: string
      path: string
      headers: Record<string, string>
      user?: unknown
    } = { method: 'GET', path: '/api/v1/assets', headers: IDENTITY }
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext
    expect(guard.canActivate(context)).toBe(true)
    expect(req.user).toEqual({ id: 'u1', email: 'u@example.com', role: 'user' })
  })
})
