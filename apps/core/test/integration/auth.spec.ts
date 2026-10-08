import request from 'supertest'
import { JwtService } from '@nestjs/jwt'
import { closeTestApp, createApiTestApp, resetDb, apiServer } from './helpers'
import type { ApiTestApp } from './helpers'
import { BullMqService } from '../../src/queue/bullmq.service'
import { RATE_LIMITS } from '../../src/users/rate-limit.service'

interface AuthBody {
  accessToken: string
  refreshToken: string
  user: { id: string; email: string; role: 'user' | 'admin'; displayName: string }
}

const PASSWORD = 'correcthorsebattery'

describe('auth HTTP surface', () => {
  let t: ApiTestApp

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
    // this app's dedicated Redis only; clear fixed-window counters so tests stay independent
    await t.app.get<BullMqService>(BullMqService).redis.flushdb()
  })

  const registerUser = (email: string, password = PASSWORD, displayName = 'Test User') =>
    request(apiServer(t)).post('/api/v1/auth/register').send({ email, password, displayName })

  const loginUser = (email: string, password = PASSWORD) =>
    request(apiServer(t)).post('/api/v1/auth/login').send({ email, password })

  describe('register', () => {
    it('creates the first user as admin and the second as user', async () => {
      const first = await registerUser('first@example.com', PASSWORD, 'First User')
      expect(first.status).toBe(201)
      const firstBody = first.body as unknown as AuthBody
      expect(firstBody.accessToken).toEqual(expect.any(String))
      expect(firstBody.refreshToken).toEqual(expect.any(String))
      expect(firstBody.user).toMatchObject({
        email: 'first@example.com',
        displayName: 'First User',
        role: 'admin',
      })

      const second = await registerUser('second@example.com')
      expect(second.status).toBe(201)
      const secondBody = second.body as unknown as AuthBody
      expect(secondBody.user.role).toBe('user')
    })

    it('rejects an invalid body with 400', async () => {
      const res = await registerUser('not-an-email', 'short', '')
      expect(res.status).toBe(400)
    })

    it('rejects a duplicate email with 409', async () => {
      expect((await registerUser('dupe@example.com')).status).toBe(201)
      const res = await registerUser('dupe@example.com')
      expect(res.status).toBe(409)
    })
  })

  describe('login', () => {
    it('returns a token pair for valid credentials', async () => {
      const registered = await registerUser('login@example.com')
      expect(registered.status).toBe(201)

      const res = await request(apiServer(t))
        .post('/api/v1/auth/login')
        .send({ email: 'login@example.com', password: PASSWORD })
      expect(res.status).toBe(200)
      const body = res.body as unknown as AuthBody
      expect(body.accessToken).toEqual(expect.any(String))
      expect(body.refreshToken).toEqual(expect.any(String))
      expect(body.user.email).toBe('login@example.com')
    })

    it('returns 401 for a wrong password', async () => {
      await registerUser('wrongpass@example.com')
      const res = await request(apiServer(t))
        .post('/api/v1/auth/login')
        .send({ email: 'wrongpass@example.com', password: 'wrong-password' })
      expect(res.status).toBe(401)
    })

    it('returns 401 for an unknown email', async () => {
      const res = await request(apiServer(t))
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: PASSWORD })
      expect(res.status).toBe(401)
    })
  })

  describe('rate limiting', () => {
    it('returns 401 below the limit, then 429 even with the correct password', async () => {
      await registerUser('limited@example.com')

      for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
        const res = await loginUser('limited@example.com', 'wrong-password')
        expect(res.status).toBe(401)
      }

      const blocked = await loginUser('limited@example.com', PASSWORD)
      expect(blocked.status).toBe(429)
    })
  })

  describe('refresh', () => {
    it('rotates the token pair and rejects the old refresh token', async () => {
      const registered = await registerUser('rotate@example.com')
      const first = registered.body as unknown as AuthBody

      const rotated = await request(apiServer(t))
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
      expect(rotated.status).toBe(200)
      const second = rotated.body as unknown as AuthBody
      expect(second.accessToken).toEqual(expect.any(String))
      expect(second.refreshToken).not.toBe(first.refreshToken)

      const replay = await request(apiServer(t))
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
      expect(replay.status).toBe(401)
    })

    it('detects reuse by rejecting an already-rotated token on the second attempt', async () => {
      const registered = await registerUser('reuse@example.com')
      const original = (registered.body as unknown as AuthBody).refreshToken

      const firstRefresh = await request(apiServer(t))
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: original })
      expect(firstRefresh.status).toBe(200)

      const secondRefresh = await request(apiServer(t))
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: original })
      expect(secondRefresh.status).toBe(401)
    })

    it('revokes the whole token family when a rotated token is reused', async () => {
      const registered = await registerUser('family@example.com')
      const original = (registered.body as unknown as AuthBody).refreshToken
      const loggedIn = await loginUser('family@example.com')
      const sibling = (loggedIn.body as unknown as AuthBody).refreshToken

      const rotate = (refreshToken: string) =>
        request(apiServer(t)).post('/api/v1/auth/refresh').send({ refreshToken })

      const rotated = await rotate(original)
      expect(rotated.status).toBe(200)
      const fresh = (rotated.body as unknown as AuthBody).refreshToken

      expect((await rotate(original)).status).toBe(401)

      // reuse detection revoked every refresh token for the user, not just the replayed one
      expect((await rotate(fresh)).status).toBe(401)
      expect((await rotate(sibling)).status).toBe(401)
    })

    it('returns 401 for an unknown refresh token and 400 for an empty one', async () => {
      const unknown = await request(apiServer(t))
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' })
      expect(unknown.status).toBe(401)

      const empty = await request(apiServer(t))
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: '' })
      expect(empty.status).toBe(400)
    })
  })

  describe('logout', () => {
    it('revokes the refresh token, is idempotent, and rejects the token afterwards', async () => {
      const registered = await registerUser('logout@example.com')
      const { refreshToken } = registered.body as unknown as AuthBody

      const logout = await request(apiServer(t)).post('/api/v1/auth/logout').send({ refreshToken })
      expect(logout.status).toBe(204)

      const afterLogout = await request(apiServer(t))
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
      expect(afterLogout.status).toBe(401)

      const again = await request(apiServer(t)).post('/api/v1/auth/logout').send({ refreshToken })
      expect(again.status).toBe(204)
    })

    it('returns 204 for an unknown refresh token', async () => {
      const res = await request(apiServer(t))
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'not-a-real-token' })
      expect(res.status).toBe(204)
    })
  })

  describe('guard integration', () => {
    it('accepts an access token from login and rejects a missing token', async () => {
      await registerUser('guard@example.com')
      const login = await request(apiServer(t))
        .post('/api/v1/auth/login')
        .send({ email: 'guard@example.com', password: PASSWORD })
      const { accessToken } = login.body as unknown as AuthBody

      const authed = await request(apiServer(t))
        .get('/api/v1/assets')
        .set(t.authHeader(accessToken))
      expect(authed.status).toBe(200)

      const anonymous = await request(apiServer(t)).get('/api/v1/assets')
      expect(anonymous.status).toBe(401)
    })
  })

  describe('expiry and identity spoofing', () => {
    const signExpired = (secondsAgo: number) =>
      t.app.get(JwtService).sign(
        {
          sub: '22222222-2222-4222-8222-222222222222',
          email: 'expired@example.com',
          role: 'user',
        },
        { expiresIn: -secondsAgo },
      )

    it('accepts a token expired within AUTH_CLOCK_TOLERANCE_SEC (60s default)', async () => {
      const res = await request(apiServer(t))
        .get('/api/v1/assets')
        .set(t.authHeader(signExpired(30)))
      expect(res.status).toBe(200)
    })

    it('returns 401 for a token expired beyond the clock tolerance', async () => {
      const res = await request(apiServer(t))
        .get('/api/v1/assets')
        .set(t.authHeader(signExpired(120)))
      expect(res.status).toBe(401)
    })

    it('takes identity from the JWT when x-user-* headers are spoofed', async () => {
      const registered = await registerUser('spoof@example.com')
      expect(registered.status).toBe(201)
      const { accessToken, user } = registered.body as unknown as AuthBody

      const res = await request(apiServer(t))
        .post('/api/v1/albums')
        .set(t.authHeader(accessToken))
        .set({
          'x-user-id': '33333333-3333-4333-8333-333333333333',
          'x-user-role': 'admin',
        })
        .send({ name: 'Spoofed' })
      expect(res.status).toBe(201)
      const album = res.body as unknown as { userId: string; name: string }
      expect(album.userId).toBe(user.id)
      expect(album.name).toBe('Spoofed')
    })

    it('returns 401 for spoofed x-user-* headers without a token', async () => {
      const res = await request(apiServer(t)).get('/api/v1/albums').set({
        'x-user-id': '33333333-3333-4333-8333-333333333333',
        'x-user-role': 'admin',
      })
      expect(res.status).toBe(401)
    })
  })
})
