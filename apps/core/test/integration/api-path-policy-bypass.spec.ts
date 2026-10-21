import { createHmac, randomUUID } from 'node:crypto'
import request from 'supertest'
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
} from './helpers'
import type { ApiTestApp } from './helpers'
import { TEST_WORKER_SECRET } from './test-setup'

/**
 * Regression tests for the path-policy bypass (API security audit, findings #1-#3 — Critical).
 *
 * The access policy is decided by a case-sensitive string prefix on the raw request path
 * (apps/core/src/auth/open-routes.ts: isOpenRoute / isAdminRoute / isWorkerRoute, read from
 * `req.path` in apps/core/src/auth/jwt-auth.guard.ts:94), while Express matches routes
 * case-insensitively (no `case sensitive routing` is set in apps/core/src/main.ts).
 *
 * The two therefore disagree: `GET /API/V1/ADMIN/USERS` resolves to the admin controller, but
 * `isAdminRoute('/API/V1/ADMIN/USERS')` is false, so the admin role check is skipped and the
 * request is served as an ordinary user. The same gap reaches the worker surface, where it also
 * skips the `X-Job-Signature` job binding.
 *
 * The property under test is deliberately strategy-agnostic: whatever the fix is (case-sensitive
 * routing, a normalised path, or route metadata instead of a path prefix), the answer to a route
 * must not depend on the case of the URL. Every test therefore asserts "the case variant answers
 * exactly like the canonical path" instead of pinning one particular status.
 *
 * These tests assert the SECURE behaviour and FAIL against the current code.
 */
describe('path-policy bypass: the route policy must not depend on the case of the path', () => {
  let t: ApiTestApp

  beforeAll(async () => {
    // mockUser: null keeps the real JwtAuthGuard in place — the guard is what is under test
    t = await createApiTestApp({ mockUser: null })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
  })

  /**
   * Two case spellings that still resolve to the same route: all-uppercase, and one that
   * alternates per path segment. Both are what a client sends by accident (a hand-written
   * curl, a proxy that rewrites, a link copied with different casing).
   */
  const caseVariants = (route: string): string[] => {
    const mixed = route
      .split('/')
      .map((segment, i) =>
        i % 2 === 1 ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment.toLowerCase(),
      )
      .join('/')
    return [route.toUpperCase(), mixed]
  }

  type Method = 'get' | 'post' | 'patch' | 'delete'

  const call = (method: Method, path: string, auth: Record<string, string>, body?: unknown) => {
    const req = request(apiServer(t))
    switch (method) {
      case 'post':
        return req
          .post(path)
          .set(auth)
          .send(body ?? {})
      case 'patch':
        return req
          .patch(path)
          .set(auth)
          .send(body ?? {})
      case 'delete':
        return req.delete(path).set(auth)
      default:
        return req.get(path).set(auth)
    }
  }

  /**
   * Asserts that the canonical path answers `expected` and that every case spelling of it
   * answers exactly the same. Divergences are collected so one run reports every leaking
   * variant instead of stopping at the first.
   */
  const expectCaseIndependent = async (
    method: Method,
    route: string,
    auth: Record<string, string>,
    expected: number,
    body?: unknown,
  ): Promise<void> => {
    const canonical = await call(method, route, auth, body)
    expect(canonical.status, `control request for ${method.toUpperCase()} ${route}`).toBe(expected)

    const divergences: string[] = []
    for (const variant of caseVariants(route)) {
      const res = await call(method, variant, auth, body)
      if (res.status !== canonical.status) {
        divergences.push(
          `${method.toUpperCase()} ${variant} → ${res.status} (canonical ${route} → ${canonical.status})`,
        )
      }
    }
    expect(divergences, `case variants must answer exactly like ${route}`).toEqual([])
  }

  const nonAdmin = async () => {
    const user = await seedUser(t)
    return t.authHeader(t.signToken({ id: user.id, email: user.email, role: 'user' }))
  }

  it('#1 a non-admin is refused on every admin route, whatever the case of the path', async () => {
    const auth = await nonAdmin()
    const target = await seedUser(t, { role: 'admin' })
    const routes = [
      '/api/v1/admin/users',
      '/api/v1/admin/users/{id}/delete-status',
      '/api/v1/admin/orphan-counts',
      '/api/v1/admin/face-detection',
      '/api/v1/admin/assets/counts',
      '/api/v1/admin/faces/reprocess',
      '/api/v1/admin/metadata/reprocess',
    ]

    for (const route of routes) {
      await expectCaseIndependent('get', route.replace('{id}', target.id), auth, 403)
    }
  })

  it('#2 a non-admin cannot read the user list through a case variant', async () => {
    const auth = await nonAdmin()
    await seedUser(t, { role: 'admin' })

    await expectCaseIndependent('get', '/api/v1/admin/users', auth, 403)

    // belt and braces: the response must not carry the user list even if the status were to differ
    for (const variant of caseVariants('/api/v1/admin/users')) {
      const res = await call('get', variant, auth)
      expect(
        JSON.stringify(res.body ?? {}),
        `${variant} must not leak the user list`,
      ).not.toContain('email')
    }
  })

  it('#3 a non-admin cannot rewrite another user’s record through a case variant', async () => {
    // account takeover: rewriting the admin account’s email (or password) hands the admin
    // credentials to whoever made the request
    const auth = await nonAdmin()
    const target = await seedUser(t, { role: 'admin' })
    const route = `/api/v1/admin/users/${target.id}`
    const pwned = `pwn-${randomUUID()}@example.com`

    await expectCaseIndependent('patch', route, auth, 403, { email: pwned })

    // the target account must be untouched, whoever asked
    const fresh = await t.userRepo.findOneOrFail({ where: { id: target.id } })
    expect(fresh.email).toBe(target.email)
  })

  it('#4 a non-admin cannot delete another account through a case variant', async () => {
    const auth = await nonAdmin()
    const victim = await seedUser(t)
    const route = `/api/v1/admin/users/${victim.id}`

    await expectCaseIndependent('delete', route, auth, 403)

    const fresh = await t.userRepo.findOneOrFail({ where: { id: victim.id } })
    expect(fresh.id).toBe(victim.id)
  })

  it('#5 a non-admin cannot trigger a library-wide maintenance action through a case variant', async () => {
    const auth = await nonAdmin()
    const routes: { path: string; body?: unknown }[] = [
      { path: '/api/v1/admin/cleanup-orphans/run' },
      { path: '/api/v1/admin/thumbnails/reprocess', body: { kind: 'photo' } },
      { path: '/api/v1/admin/faces/reprocess' },
      { path: '/api/v1/admin/embeddings/reprocess' },
      { path: '/api/v1/admin/places/backfill' },
    ]

    for (const route of routes) {
      await expectCaseIndependent('post', route.path, auth, 403, route.body)
    }
  })

  it('#6 the worker surface is not reachable by a plain user token through a case variant', async () => {
    // the worker job surface is act-only and requires the X-Job-Signature job binding; a plain
    // user token must never reach it, and the case gap must not be a way around either control
    const auth = await nonAdmin()

    await expectCaseIndependent('get', '/worker/assets', auth, 403)
  })

  it('#7 a properly signed worker call still works on the canonical path', async () => {
    // guards against an over-broad fix: the worker lane must keep working
    const user = await seedUser(t)
    const file = await seedFile(t, user.id)
    const asset = await seedAsset(t, user.id, file.id)
    const job = t.signWorkerToken({ id: user.id, email: user.email, role: 'user' }, { act: true })
    const sig = createHmac('sha256', TEST_WORKER_SECRET)
      .update(`${user.id}:${asset.id}`)
      .digest('hex')

    const res = await request(apiServer(t))
      .get(`/worker/assets/${asset.id}`)
      .set(t.authHeader(job))
      .set('X-Job-Signature', sig)
      .set('X-Job-Scope', asset.id)
    expect(res.status).toBe(200)
  })

  it('#8 an admin keeps full access to the admin surface', async () => {
    // guards against an over-broad fix: the admin role must still reach every admin route
    const admin = await seedUser(t, { role: 'admin' })
    const auth = t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: 'admin' }))

    for (const route of ['/api/v1/admin/users', '/api/v1/admin/orphan-counts']) {
      expect((await call('get', route, auth)).status, route).toBe(200)
    }
  })
})
