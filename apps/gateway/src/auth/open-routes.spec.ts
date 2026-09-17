import { isAdminRoute, isOpenRoute } from './open-routes'

// ponytail: exact-match parity table duplicated in
// apps/core/src/auth/gateway-identity.guard.spec.ts (no cross-app imports) —
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

describe('open-route parity table', () => {
  it.each(CASES)('%s %s → open=%s', (method, path, expected) => {
    expect(isOpenRoute(method, path)).toBe(expected)
  })

  it('flags all /api/v1/admin/* as admin-only', () => {
    expect(isAdminRoute('/api/v1/admin')).toBe(true)
    expect(isAdminRoute('/api/v1/admin/users')).toBe(true)
    expect(isAdminRoute('/api/v1/assets')).toBe(false)
  })
})
