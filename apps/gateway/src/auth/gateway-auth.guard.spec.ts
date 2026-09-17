import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import type { JwtService } from '@nestjs/jwt'
import { GatewayAuthGuard, type IdentityRequest } from './gateway-auth.guard'

const SECRET_PAYLOAD = { sub: 'u1', email: 'u@example.com', role: 'user' as const }

function testContext(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): { context: ExecutionContext; req: IdentityRequest } {
  const req = { method, path, headers } as unknown as IdentityRequest
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
  return { context, req }
}

function guardWith(verify: (token: string) => unknown): GatewayAuthGuard {
  const jwt = { verify: vi.fn(verify) } as unknown as JwtService
  return new GatewayAuthGuard(jwt)
}

describe('GatewayAuthGuard', () => {
  it('lets open routes through without a token', () => {
    const guard = guardWith(() => {
      throw new Error('must not verify')
    })
    const open: [string, string][] = [
      ['GET', '/docs'],
      ['GET', '/docs-json'],
      ['POST', '/api/v1/auth/login'],
      ['POST', '/api/v1/auth/refresh'],
      ['GET', '/api/share/abc'],
      ['GET', '/api/share/abc/stream'],
      ['GET', '/api/v1/files/f1/stream'],
      ['GET', '/health'],
    ]
    for (const [method, path] of open) {
      expect(guard.canActivate(testContext(method, path).context)).toBe(true)
    }
  })

  it('rejects protected routes without a token with 401', () => {
    const guard = guardWith(() => SECRET_PAYLOAD)
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

  it('rejects expired/invalid tokens with 401', () => {
    const guard = guardWith(() => {
      throw new Error('jwt expired')
    })
    expect(() =>
      guard.canActivate(
        testContext('GET', '/api/v1/assets', { authorization: 'Bearer stale' }).context,
      ),
    ).toThrow(UnauthorizedException)
  })

  it('attaches identity from a valid token', () => {
    const guard = guardWith(() => SECRET_PAYLOAD)
    const { context, req } = testContext('GET', '/api/v1/assets', {
      authorization: 'Bearer good',
    })
    expect(guard.canActivate(context)).toBe(true)
    expect(req.user).toEqual({ id: 'u1', email: 'u@example.com', role: 'user' })
  })

  it('rejects non-admin on /api/v1/admin/* with 403', () => {
    const guard = guardWith(() => SECRET_PAYLOAD)
    try {
      guard.canActivate(
        testContext('GET', '/api/v1/admin/users', { authorization: 'Bearer good' }).context,
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
    const guard = guardWith(() => ({ ...SECRET_PAYLOAD, role: 'admin' as const }))
    const { context, req } = testContext('GET', '/api/v1/admin/users', {
      authorization: 'Bearer admin',
    })
    expect(guard.canActivate(context)).toBe(true)
    expect(req.user?.role).toBe('admin')
  })
})
