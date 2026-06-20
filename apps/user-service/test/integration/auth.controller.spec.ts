import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import supertest from 'supertest'
import { randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import { setupTestInfra, teardownTestInfra } from './test-setup'
import type { AuthResponse } from '@photox/shared-types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  await setupTestInfra()

  // @ts-expect-error dynamic import — tsc can't resolve test→src paths, vitest can
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { AppModule } = await import('../../src/app.module')

  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = module.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  await app.init()
  httpServer = app.getHttpServer() as Server
}, 120_000)

afterAll(async () => {
  await app?.close()
  await teardownTestInfra()
})

function uniqueEmail() {
  return `${randomUUID()}@test.com`
}

function validPayload(overrides?: { email?: string; password?: string; displayName?: string }) {
  return {
    email: uniqueEmail(),
    password: 'correcthorsebatterystaple',
    displayName: 'Ada Lovelace',
    ...overrides,
  }
}

interface ErrorBody {
  message: string | string[]
  statusCode: number
  error?: string
}

function randomEmail(): string {
  return `test-${randomBytes(4).toString('hex')}@example.com`
}

function randomPassword(): string {
  return `pw-${randomBytes(4).toString('hex')}`
}

async function registerUser(email: string, password: string): Promise<AuthResponse> {
  const res = await supertest(httpServer)
    .post('/v1/auth/register')
    .send({ email, password, displayName: 'Test User' })
    .expect(201)
  return res.body as AuthResponse
}

async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const res = await supertest(httpServer)
    .post('/v1/auth/login')
    .send({ email, password })
    .expect(200)
  return res.body as AuthResponse
}

describe('POST /v1/auth/register', () => {
  it('REG-01: creates account and returns AuthResponse', async () => {
    const payload = validPayload()
    const res = await supertest(httpServer).post('/v1/auth/register').send(payload).expect(201)
    const body = res.body as AuthResponse
    expect(typeof body.accessToken).toBe('string')
    expect(body.accessToken.length).toBeGreaterThan(0)
    expect(typeof body.refreshToken).toBe('string')
    expect(body.refreshToken.length).toBeGreaterThan(0)
    expect(body.user).toBeDefined()
    expect(typeof body.user.id).toBe('string')
    expect(UUID_RE.test(body.user.id)).toBe(true)
    expect(body.user.email).toBe(payload.email)
    expect(body.user.displayName).toBe(payload.displayName)
    expect(typeof body.user.createdAt).toBe('string')
    expect(new Date(body.user.createdAt).toISOString()).toBe(body.user.createdAt)
    expect(typeof body.user.updatedAt).toBe('string')
    expect(new Date(body.user.updatedAt).toISOString()).toBe(body.user.updatedAt)
  })

  it('REG-02: returns 409 on duplicate email', async () => {
    const email = uniqueEmail()
    await supertest(httpServer).post('/v1/auth/register').send(validPayload({ email })).expect(201)

    const res = await supertest(httpServer)
      .post('/v1/auth/register')
      .send(validPayload({ email }))
      .expect(409)
    const body = res.body as ErrorBody

    expect(body.message).toBe('Email already registered')
  })

  it('REG-03: returns 400 on invalid email', async () => {
    const res = await supertest(httpServer)
      .post('/v1/auth/register')
      .send(validPayload({ email: 'not-an-email' }))
      .expect(400)
    const body = res.body as ErrorBody

    expect(body.message).toBeDefined()
  })

  it('REG-04: returns 400 on password too short', async () => {
    const res = await supertest(httpServer)
      .post('/v1/auth/register')
      .send(validPayload({ password: 'short' }))
      .expect(400)
    const body = res.body as ErrorBody

    expect(body.message).toBeDefined()
  })

  it('REG-05: accepts password at max length (128)', async () => {
    await supertest(httpServer)
      .post('/v1/auth/register')
      .send(validPayload({ password: 'a'.repeat(128) }))
      .expect(201)
  })

  it('REG-06: returns 400 on password over max (129)', async () => {
    await supertest(httpServer)
      .post('/v1/auth/register')
      .send(validPayload({ password: 'a'.repeat(129) }))
      .expect(400)
  })

  it('REG-07: returns 400 on empty displayName', async () => {
    const res = await supertest(httpServer)
      .post('/v1/auth/register')
      .send(validPayload({ displayName: '' }))
      .expect(400)
    const body = res.body as ErrorBody

    expect(body.message).toBeDefined()
  })

  it('REG-08: accepts displayName at max length (64)', async () => {
    await supertest(httpServer)
      .post('/v1/auth/register')
      .send(validPayload({ displayName: 'A'.repeat(64) }))
      .expect(201)
  })

  it('REG-09: returns 400 on displayName over max (65)', async () => {
    await supertest(httpServer)
      .post('/v1/auth/register')
      .send(validPayload({ displayName: 'A'.repeat(65) }))
      .expect(400)
  })

  it('REG-10: returns 400 on missing password', async () => {
    const { email, displayName } = validPayload()
    const res = await supertest(httpServer)
      .post('/v1/auth/register')
      .send({ email, displayName })
      .expect(400)
    const body = res.body as ErrorBody

    expect(body.message).toBeDefined()
  })

  it('REG-11: returns 400 on extra unknown field (forbidNonWhitelisted)', async () => {
    const res = await supertest(httpServer)
      .post('/v1/auth/register')
      .send({ ...validPayload(), hack: 'x' })
      .expect(400)
    const body = res.body as ErrorBody

    expect(body.message).toBeDefined()
  })

  it('REG-12: returns 400 on empty body', async () => {
    const res = await supertest(httpServer).post('/v1/auth/register').send({}).expect(400)
    const body = res.body as ErrorBody

    expect(body.message).toBeDefined()
  })
})

describe('POST /v1/auth/login', () => {
  it('LOG-01: happy path — valid credentials returns 200 + AuthResponse', async () => {
    const email = randomEmail()
    const password = randomPassword()
    await registerUser(email, password)

    const res = await supertest(httpServer)
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200)

    const body = res.body as AuthResponse
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.user).toBeDefined()
    expect(body.user.email).toBe(email)
  })

  it('LOG-02: wrong password returns 401 with "Invalid credentials"', async () => {
    const email = randomEmail()
    const password = randomPassword()
    await registerUser(email, password)

    const res = await supertest(httpServer)
      .post('/v1/auth/login')
      .send({ email, password: 'wrongpassword' })
      .expect(401)

    const body = res.body as { message: string }
    expect(body.message).toBe('Invalid credentials')
  })

  it('LOG-03: non-existent email returns 401 with "Invalid credentials"', async () => {
    const res = await supertest(httpServer)
      .post('/v1/auth/login')
      .send({ email: randomEmail(), password: 'anypassword' })
      .expect(401)

    const body = res.body as { message: string }
    expect(body.message).toBe('Invalid credentials')
  })

  it('LOG-04: invalid email format returns 400', async () => {
    await supertest(httpServer)
      .post('/v1/auth/login')
      .send({ email: 'not-an-email', password: 'password' })
      .expect(400)
  })

  it('LOG-05: missing password returns 400', async () => {
    await supertest(httpServer).post('/v1/auth/login').send({ email: randomEmail() }).expect(400)
  })

  it('LOG-06: empty password returns 400', async () => {
    await supertest(httpServer)
      .post('/v1/auth/login')
      .send({ email: randomEmail(), password: '' })
      .expect(400)
  })

  it('LOG-07: response tokens are non-empty truthy strings', async () => {
    const email = randomEmail()
    const password = randomPassword()
    await registerUser(email, password)

    const res = await supertest(httpServer)
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200)

    const body = res.body as AuthResponse
    expect(typeof body.accessToken).toBe('string')
    expect(body.accessToken.length).toBeGreaterThan(0)
    expect(typeof body.refreshToken).toBe('string')
    expect(body.refreshToken.length).toBeGreaterThan(0)
  })

  it('LOG-02+03: wrong password and non-existent email return the same error message', async () => {
    const email = randomEmail()
    await registerUser(email, randomPassword())

    const wrongPw = await supertest(httpServer)
      .post('/v1/auth/login')
      .send({ email, password: 'wrongpassword' })
      .expect(401)

    const noUser = await supertest(httpServer)
      .post('/v1/auth/login')
      .send({ email: randomEmail(), password: 'anypassword' })
      .expect(401)

    expect((wrongPw.body as { message: string }).message).toBe(
      (noUser.body as { message: string }).message,
    )
  })
})

describe('POST /v1/auth/refresh', () => {
  it('REF-01: happy path — login then rotate token', async () => {
    const email = randomEmail()
    const password = randomPassword()
    await registerUser(email, password)
    const login = await loginUser(email, password)

    const res = await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken })
      .expect(200)

    const body = res.body as AuthResponse
    expect(typeof body.accessToken).toBe('string')
    expect(body.accessToken.length).toBeGreaterThan(0)
    expect(typeof body.refreshToken).toBe('string')
    expect(body.refreshToken.length).toBeGreaterThan(0)
    expect(body.accessToken).not.toBe(login.accessToken)
    expect(body.refreshToken).not.toBe(login.refreshToken)
  })

  it('REF-02: old token revoked after rotation', async () => {
    const email = randomEmail()
    const reg = await registerUser(email, randomPassword())

    const res = await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.refreshToken })
      .expect(200)

    const body = res.body as AuthResponse
    expect(body.refreshToken).not.toBe(reg.refreshToken)

    await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.refreshToken })
      .expect(401)
  })

  it('REF-03: invalid random token returns 401', async () => {
    await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'does-not-exist' })
      .expect(401)
  })

  it('REF-04: double-use same token — 1st 200, 2nd 401', async () => {
    const email = randomEmail()
    const reg = await registerUser(email, randomPassword())

    await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.refreshToken })
      .expect(200)

    await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.refreshToken })
      .expect(401)
  })

  it('REF-05: chained rotation — register then refresh then refresh', async () => {
    const email = randomEmail()
    const reg = await registerUser(email, randomPassword())

    const res1 = await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.refreshToken })
      .expect(200)

    const body1 = res1.body as AuthResponse

    const res2 = await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: body1.refreshToken })
      .expect(200)

    const body2 = res2.body as AuthResponse
    expect(body2.accessToken).toBeTruthy()
    expect(body2.refreshToken).toBeTruthy()
  })

  it('REF-06: missing field returns 400', async () => {
    await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({})
      .expect(400)
  })

  it('REF-07: user identity preserved after refresh', async () => {
    const email = randomEmail()
    const reg = await registerUser(email, randomPassword())

    const res = await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.refreshToken })
      .expect(200)

    const body = res.body as AuthResponse
    expect(body.user.id).toBe(reg.user.id)
    expect(body.user.email).toBe(email)
  })
})

describe('POST /v1/auth/logout', () => {
  it('OUT-01: happy path — revoke token via login', async () => {
    const email = randomEmail()
    const password = randomPassword()
    await registerUser(email, password)
    const login = await loginUser(email, password)

    await supertest(httpServer)
      .post('/v1/auth/logout')
      .send({ refreshToken: login.refreshToken })
      .expect(204)
  })

  it('OUT-02: revoked token cannot be used for refresh', async () => {
    const email = randomEmail()
    const reg = await registerUser(email, randomPassword())

    await supertest(httpServer)
      .post('/v1/auth/logout')
      .send({ refreshToken: reg.refreshToken })
      .expect(204)

    await supertest(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.refreshToken })
      .expect(401)
  })

  it('OUT-03: idempotent — logout same token twice', async () => {
    const email = randomEmail()
    const reg = await registerUser(email, randomPassword())

    await supertest(httpServer)
      .post('/v1/auth/logout')
      .send({ refreshToken: reg.refreshToken })
      .expect(204)

    await supertest(httpServer)
      .post('/v1/auth/logout')
      .send({ refreshToken: reg.refreshToken })
      .expect(204)
  })

  it('OUT-04: invalid token is still 204', async () => {
    await supertest(httpServer)
      .post('/v1/auth/logout')
      .send({ refreshToken: 'garbage' })
      .expect(204)
  })

  it('OUT-05: missing field returns 400', async () => {
    await supertest(httpServer)
      .post('/v1/auth/logout')
      .send({})
      .expect(400)
  })
})
