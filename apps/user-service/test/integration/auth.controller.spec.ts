import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import supertest from 'supertest'
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
