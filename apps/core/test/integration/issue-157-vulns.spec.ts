import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { vi } from 'vitest'
import { JwtService } from '@nestjs/jwt'
import type { Redis } from 'ioredis'
import { loadAuthEnv } from '@photox/shared-config'
import { TEST_AUTH_SECRET_PREVIOUS } from './test-setup'
import { ACCESS_COOKIE } from '../../src/auth/auth-cookie'
import { RATE_LIMITS } from '../../src/users/rate-limit.service'
import { BullMqService } from '../../src/queue/bullmq.service'
import { Share } from '../../src/shares/entities/share.entity'
import { RefreshToken } from '../../src/users/entities/refresh-token.entity'
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

interface AuthBody {
  accessToken: string
  refreshToken: string
  user: { id: string; email: string; role: 'user' | 'admin' }
}

const PASSWORD = 'correcthorsebattery'

// issue #157: each test expects SECURE behavior and FAILS on current code — except the
// #11 probe, which passes either way and documents the guard-vs-router outcome.
describe('issue-157 vulns (expect secure, currently insecure)', () => {
  let t: ApiTestApp

  beforeAll(async () => {
    // the rotation test needs the previous secret at app boot (guard reads env in constructor)
    process.env.AUTH_TOKEN_SECRET_PREVIOUS = TEST_AUTH_SECRET_PREVIOUS
    t = await createApiTestApp({ mockUser: null })
  }, 120_000)

  afterAll(async () => {
    delete process.env.AUTH_TOKEN_SECRET_PREVIOUS
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
    await t.app.get<BullMqService>(BullMqService).redis.flushdb()
  })

  const registerUser = (email: string) =>
    request(apiServer(t))
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Test User' })

  const loginUser = (email: string, password = PASSWORD) =>
    request(apiServer(t)).post('/api/v1/auth/login').send({ email, password })

  const refresh = (refreshToken: string) =>
    request(apiServer(t)).post('/api/v1/auth/refresh').send({ refreshToken })

  type AuthRes = Awaited<ReturnType<typeof registerUser>>

  const setCookies = (res: AuthRes): string[] =>
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []

  const cookieJar = (res: AuthRes): string =>
    setCookies(res).find((c) => c.startsWith(`${ACCESS_COOKIE}=`))?.split(';')[0] ?? ''

  // gate-1: the session floor compares at second granularity (access iat is seconds), so a
  // logout/reuse in the same second as login can't kill the token — cross a second boundary
  // first to make the kill deterministic (bounded ≤1s poll, accepts the sub-second kill-window)
  const crossSecondBoundary = async (): Promise<void> => {
    const start = Math.floor(Date.now() / 1000)
    while (Math.floor(Date.now() / 1000) === start)
      await new Promise((r) => setTimeout(r, 25))
  }

  it('#6 logout kills access: Bearer and cookie are 401 after logout', async () => {
    // issue-157#6: logout must kill the session — FAILS today because logout only revokes
    // the single refresh row (auth.service.ts:98-107) while stateless access JWTs keep
    // verifying (jwt-auth.guard.ts:84-92 performs no revocation check)
    expect((await registerUser('logout-kills@example.com')).status).toBe(201)
    const login = await loginUser('logout-kills@example.com')
    expect(login.status).toBe(200)
    const { accessToken, refreshToken } = login.body as unknown as AuthBody
    const jar = cookieJar(login)
    await crossSecondBoundary()

    expect(
      (await request(apiServer(t)).post('/api/v1/auth/logout').send({ refreshToken })).status,
    ).toBe(204)

    const viaBearer = await request(apiServer(t))
      .get('/api/v1/assets')
      .set(t.authHeader(accessToken))
    expect(viaBearer.status).toBe(401)
    const viaCookie = await request(apiServer(t)).get('/api/v1/assets').set('Cookie', jar)
    expect(viaCookie.status).toBe(401)
  })

  it('#7 no infinite sliding: chained refreshes never extend past the absolute cap', async () => {
    // issue-157#7: refresh must not extend the session forever — expiry still slides per
    // rotation (up to AUTH_REFRESH_TTL) but never past the absolute cap minted at first issue
    const reg = await registerUser('sliding@example.com')
    expect(reg.status).toBe(201)
    const first = reg.body as unknown as AuthBody
    const columns = t.dataSource.getMetadata(RefreshToken).columns.map((c) => c.propertyName)
    expect(columns).toContain('absoluteExpiresAt')
    const before = await t.refreshRepo.find({ where: { userId: first.user.id } })
    expect(before).toHaveLength(1)
    const absolute = before[0]?.absoluteExpiresAt?.getTime() ?? 0
    expect(absolute).toBeGreaterThan(0)

    const rotated = await refresh(first.refreshToken)
    expect(rotated.status).toBe(200)
    const rotatedAgain = await refresh((rotated.body as unknown as AuthBody).refreshToken)
    expect(rotatedAgain.status).toBe(200)

    const rows = await t.refreshRepo.find({ where: { userId: first.user.id } })
    const live = rows.filter((r) => !r.revokedAt)
    expect(live).toHaveLength(1)
    expect(live[0]?.absoluteExpiresAt?.getTime()).toBe(absolute)
    expect(live[0]?.expiresAt.getTime() ?? 0).toBeLessThanOrEqual(absolute)
  })

  it('#7b absolute cap enforced: refresh past absoluteExpiresAt is 401', async () => {
    // gate-1 note: the cap must actually reject — backdate it via the repo instead of
    // advancing the clock, so the case stays deterministic with no fake timers
    const reg = await registerUser('cap-enforced@example.com')
    expect(reg.status).toBe(201)
    const first = reg.body as unknown as AuthBody

    const rows = await t.refreshRepo.find({ where: { userId: first.user.id } })
    const row = rows.find((r) => !r.revokedAt)
    if (!row?.id) throw new Error('expected one live refresh row')
    await t.refreshRepo.update(row.id, { absoluteExpiresAt: new Date(Date.now() - 1000) })

    expect((await refresh(first.refreshToken)).status).toBe(401)
  })

  it('#8 cookie renewal respects revocation: cookie is 401 after refresh-family revoke', async () => {
    // issue-157#8: a stolen cookie must die with its refresh family — FAILS today because the
    // guard re-mints purely from the verified payload (jwt-auth.guard.ts:114-132) with no
    // revocation/session check, so the cookie outlives the family delete below
    expect((await registerUser('cookie-revoke@example.com')).status).toBe(201)
    const login = await loginUser('cookie-revoke@example.com')
    expect(login.status).toBe(200)
    const { refreshToken } = login.body as unknown as AuthBody
    const jar = cookieJar(login)
    expect(jar).not.toBe('')
    await crossSecondBoundary()

    // rotate once, then replay the original to trigger reuse detection (whole-family delete)
    expect((await refresh(refreshToken)).status).toBe(200)
    expect((await refresh(refreshToken)).status).toBe(401)

    const viaCookie = await request(apiServer(t)).get('/api/v1/assets').set('Cookie', jar)
    expect(viaCookie.status).toBe(401)
  })

  it('#9 rate-limit fail-closed: login is 503 when Redis is down, 429 when over limit', async () => {
    // issue-157#9: auth rate limits must fail closed — consume() rejects with 503 when Redis
    // is unavailable or slow (rate-limit.service.ts), never fail-open
    await registerUser('failclosed@example.com')
    const bullMq = t.app.get<BullMqService>(BullMqService)
    // the "not yet connected" path: countHit returns null for an undefined client
    const redisGet = vi
      .spyOn(bullMq, 'redis', 'get')
      .mockReturnValue(undefined as unknown as Redis)
    try {
      // Redis down rejects even with the correct password — no free attempts from a blip
      expect((await loginUser('failclosed@example.com', PASSWORD)).status).toBe(503)
    } finally {
      redisGet.mockRestore()
    }
    // healthy Redis: 401s below the limit, then 429 even with the correct password
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      const res = await loginUser('failclosed@example.com', 'wrong-password')
      expect(res.status).toBe(401)
    }
    expect((await loginUser('failclosed@example.com', PASSWORD)).status).toBe(429)
  })

  it('#9b trust proxy: X-Forwarded-For selects the rate-limit bucket', async () => {
    // main.ts sets 'trust proxy', so req.ip (and the bucket) follows the leftmost XFF entry
    const attempt = (email: string, ip: string) =>
      request(apiServer(t))
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'wrong-password' })
    // distinct emails isolate the per-IP bucket (limit 20); each attempt is a 401
    for (let i = 0; i < RATE_LIMITS.loginIp.limit; i++) {
      expect((await attempt(`ipuser-${i}@example.com`, '10.9.9.9')).status).toBe(401)
    }
    // the same IP shares one bucket — a fresh email is still over the per-IP limit
    expect((await attempt('fresh@example.com', '10.9.9.9')).status).toBe(429)
    // a distinct IP gets a fresh bucket
    expect((await attempt('fresh@example.com', '10.9.9.10')).status).toBe(401)
  })

  it('#11 admin prefix bypass: path evasions of /api/v1/admin/users are never 200', async () => {
    // issue-157#11: guard prefix check vs router normalization — FAILS today only if an
    // evasion returns 200 (open-routes.ts:2-14 isAdminRoute vs express route matching)
    const reg = await registerUser('nonadmin@example.com')
    expect(reg.status).toBe(201)
    const { accessToken } = reg.body as unknown as AuthBody
    const control = await request(apiServer(t))
      .get('/api/v1/admin/users')
      .set(t.authHeader(accessToken))
    expect(control.status).toBe(403)
    for (const evasive of [
      '//api/v1/admin/users',
      '/%61pi/v1/admin/users',
      '/./api/v1/admin/users',
      '/api//v1//admin//users',
      '/api/v1/admin/users/',
    ]) {
      const res = await request(apiServer(t)).get(evasive).set(t.authHeader(accessToken))
      expect([403, 404]).toContain(res.status)
    }
  })

  it('#12a share expiry: Share rows carry an expiresAt bound', () => {
    // issue-157#12: shares must expire — FAILS today because share.entity.ts:21-50 has no
    // expiresAt column and getByToken never checks one
    const columns = t.dataSource.getMetadata(Share).columns.map((c) => c.propertyName)
    expect(columns).toContain('expiresAt')
  })

  it('#12b share rotation: re-sharing an asset mints a new token', async () => {
    // issue-157#12: re-share must rotate the capability — FAILS today because create returns
    // the existing row with the same token (shares.service.ts:50-54)
    const u = await seedUser(t)
    const file = await seedFile(t, u.id)
    const asset = await seedAsset(t, u.id, file.id)
    const auth = t.authHeader(t.signToken({ id: u.id, email: u.email, role: u.role }))
    const first = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(auth)
      .send({ assetId: asset.id })
    expect(first.status).toBe(201)
    const second = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(auth)
      .send({ assetId: asset.id })
    expect(second.status).toBe(201)
    expect((second.body as unknown as { token: string }).token).not.toBe(
      (first.body as unknown as { token: string }).token,
    )
  })

  it('#12c share payload: public share JSON exposes no file/user ids on the asset', async () => {
    // issue-157#12: public JSON must not leak internal ids — FAILS today because toPublicAsset
    // leaks fileId/transcodeFileId/userId (shares.service.ts:216-231)
    const u = await seedUser(t)
    const file = await seedFile(t, u.id)
    const asset = await seedAsset(t, u.id, file.id)
    const auth = t.authHeader(t.signToken({ id: u.id, email: u.email, role: u.role }))
    const created = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(auth)
      .send({ assetId: asset.id })
    expect(created.status).toBe(201)
    const pub = await request(apiServer(t)).get(
      `/api/share/${(created.body as unknown as { token: string }).token}`,
    )
    expect(pub.status).toBe(200)
    const body = pub.body as unknown as { asset: Record<string, unknown> }
    expect(Object.keys(body.asset)).toEqual(
      expect.not.arrayContaining(['fileId', 'transcodeFileId', 'userId']),
    )
  })

  it('#13 cookie flags: Secure follows X-Forwarded-Proto (https yes, plain http no)', async () => {
    // issue-157#13: Secure must be conditional — unconditional Secure would stop sending the
    // cookie over plain-HTTP host dev, while missing Secure on https leaks it to the network
    const cookieLines = (res: AuthRes): string[] =>
      (setCookies(res).filter((line) => line.startsWith('photox_')))
    const https = await request(apiServer(t))
      .post('/api/v1/auth/register')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: 'https-flags@example.com', password: PASSWORD, displayName: 'Test User' })
    expect(https.status).toBe(201)
    const httpsLines = cookieLines(https)
    expect(httpsLines).toHaveLength(2)
    for (const line of httpsLines) {
      expect(line).toMatch(/Secure/)
      expect(line).toMatch(/HttpOnly/)
    }

    const http = await registerUser('http-flags@example.com')
    expect(http.status).toBe(201)
    const httpLines = cookieLines(http)
    expect(httpLines).toHaveLength(2)
    for (const line of httpLines) {
      expect(line).not.toMatch(/Secure/)
      expect(line).toMatch(/HttpOnly/)
    }
  })

  it('#10 secret strength: loadAuthEnv rejects a low-entropy 32-char secret', () => {
    // issue-157#10: weak secrets must be rejected — the auth env schema enforces an entropy
    // floor (16+ unique chars, no 6+ identical run) on top of min length
    const prev = process.env.AUTH_TOKEN_SECRET
    process.env.AUTH_TOKEN_SECRET = 'a'.repeat(32)
    try {
      expect(() => loadAuthEnv()).toThrow()
    } finally {
      if (prev === undefined) delete process.env.AUTH_TOKEN_SECRET
      else process.env.AUTH_TOKEN_SECRET = prev
    }
  })

  it('#10b secret rotation: previous-signed access token still verifies', async () => {
    // rotation keeps AUTH_TOKEN_SECRET_PREVIOUS as a verify fallback — pre-rotation tokens
    // stay valid while fresh logins mint kid 'cur' under the current secret
    const reg = await registerUser('rotated@example.com')
    expect(reg.status).toBe(201)
    const { user } = reg.body as unknown as AuthBody
    const prevToken = new JwtService({ secret: TEST_AUTH_SECRET_PREVIOUS }).sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    })
    expect(
      (await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(prevToken))).status,
    ).toBe(200)

    const login = await loginUser('rotated@example.com')
    expect(login.status).toBe(200)
    const { accessToken } = login.body as unknown as AuthBody
    expect(
      (await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(accessToken))).status,
    ).toBe(200)
    const decoded = t.app
      .get(JwtService)
      .decode<{ header: { kid?: string } }>(accessToken, { complete: true })
    expect(decoded?.header.kid).toBe('cur')
  })

  it('#10c worker split: worker-secret token without act is 401, act-bearing works', async () => {
    // phase-2 secret split: worker-origin tokens verify under WORKER_JWT_SECRET, but without
    // act there is no users row to check and the floor fails closed
    const ghost = t.signWorkerToken({ id: randomUUID(), email: 'ghost@example.com', role: 'user' })
    expect(
      (await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(ghost))).status,
    ).toBe(401)

    // the worker face-detection call (act + admin on the allowlist) keeps working
    const face = t.signWorkerToken(
      { id: 'worker-service', email: 'worker@internal', role: 'admin' },
      { act: true },
    )
    expect(
      (await request(apiServer(t)).get('/api/v1/admin/face-detection').set(t.authHeader(face)))
        .status,
    ).toBe(200)

    // act-bearing user-sub worker token on a /worker route works (floor applies as today)
    const u = await seedUser(t)
    const file = await seedFile(t, u.id)
    const asset = await seedAsset(t, u.id, file.id)
    const job = t.signWorkerToken({ id: u.id, email: u.email, role: u.role }, { act: true })
    expect(
      (await request(apiServer(t)).get(`/worker/assets/${asset.id}`).set(t.authHeader(job)))
        .status,
    ).toBe(200)
  })

  it('#10d worker split: worker-secret admin token without act is 401 for a real user', async () => {
    // gate-2: workerOrigin without act must not borrow the real row's floor pass — a
    // worker-secret token with an existing sub + admin role is still 401 everywhere
    const u = await seedUser(t)
    const forged = t.signWorkerToken({ id: u.id, email: u.email, role: 'admin' })
    expect(
      (await request(apiServer(t)).get('/api/v1/assets').set(t.authHeader(forged))).status,
    ).toBe(401)
    expect(
      (await request(apiServer(t)).get('/api/v1/admin/users').set(t.authHeader(forged))).status,
    ).toBe(401)
  })
})
