import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { setupTestInfra, teardownTestInfra } from './test-setup'
import type { AdminUserListResponse, AuthResponse } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  await setupTestInfra()

  // @ts-expect-error dynamic import — vitest resolves test→src paths
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { AppModule } = await import('../../src/app.module')

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile()

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

async function registerUser(
  email: string,
  password = 'correcthorsebatterystaple',
): Promise<AuthResponse> {
  const res = await supertest(httpServer)
    .post('/v1/auth/register')
    .send({ email, password, displayName: 'Test User' })
    .expect(201)
  return res.body as AuthResponse
}

function uniqueEmail(): string {
  return `${randomUUID()}@test.com`
}

describe('GET /v1/admin/users', () => {
  it('ADM-U1: default pagination returns all registered users', async () => {
    const e1 = uniqueEmail()
    const e2 = uniqueEmail()
    const e3 = uniqueEmail()
    await registerUser(e1)
    await registerUser(e2)
    await registerUser(e3)

    const res = await supertest(httpServer).get('/v1/admin/users').expect(200)

    const body = res.body as AdminUserListResponse
    expect(body.total).toBeGreaterThanOrEqual(3)
    expect(body.limit).toBe(20)
    expect(body.offset).toBe(0)
    expect(body.items.length).toBeGreaterThanOrEqual(3)
  })

  it('ADM-U2: search filter matches partial email', async () => {
    const needle = `searchable-${randomUUID()}`
    const e1 = `${needle}@test.com`
    const e2 = uniqueEmail()
    await registerUser(e1)
    await registerUser(e2)

    const res = await supertest(httpServer).get(`/v1/admin/users?q=${needle}`).expect(200)

    const body = res.body as AdminUserListResponse
    expect(body.items.length).toBeGreaterThanOrEqual(1)
    expect(body.items.every((u) => u.email.includes(needle))).toBe(true)
  })

  it('ADM-U3: role filter returns only matching role', async () => {
    const allRes = await supertest(httpServer).get('/v1/admin/users?role=admin').expect(200)
    const allBody = allRes.body as AdminUserListResponse

    expect(allBody.items.length).toBeGreaterThanOrEqual(1)
    expect(allBody.items.every((u) => u.role === 'admin')).toBe(true)
  })

  it('ADM-U4: sort by email ascending', async () => {
    const prefix = `sorttest-${randomUUID()}`
    const emails = [`${prefix}-aaa@test.com`, `${prefix}-zzz@test.com`, `${prefix}-mmm@test.com`]
    for (const e of emails) await registerUser(e)

    const res = await supertest(httpServer)
      .get(`/v1/admin/users?q=${prefix}&sort=email:asc`)
      .expect(200)

    const body = res.body as AdminUserListResponse
    const returnedEmails = body.items.map((u) => u.email).filter((e) => e.includes(prefix))
    expect(returnedEmails).toEqual([...returnedEmails].sort())
  })

  it('ADM-U5: pagination with limit and offset', async () => {
    const prefix = `page-${randomUUID()}`
    const emails = [`${prefix}-1@test.com`, `${prefix}-2@test.com`, `${prefix}-3@test.com`]
    for (const e of emails) await registerUser(e)

    const page1 = await supertest(httpServer)
      .get(`/v1/admin/users?q=${prefix}&sort=email:asc&limit=1&offset=0`)
      .expect(200)

    const body1 = page1.body as AdminUserListResponse
    expect(body1.items.length).toBe(1)
    expect(body1.total).toBeGreaterThanOrEqual(3)
    expect(body1.items[0]!.email).toContain(prefix)

    const page2 = await supertest(httpServer)
      .get(`/v1/admin/users?q=${prefix}&sort=email:asc&limit=1&offset=1`)
      .expect(200)

    const body2 = page2.body as AdminUserListResponse
    expect(body2.items.length).toBe(1)
    expect(body2.items[0]!.email).not.toBe(body1.items[0]!.email)
  })

  it('ADM-U6: returns 400 on invalid sort format', async () => {
    await supertest(httpServer).get('/v1/admin/users?sort=invalid').expect(400)
  })

  it('ADM-U7: returns 400 when limit is 0', async () => {
    await supertest(httpServer).get('/v1/admin/users?limit=0').expect(400)
  })

  it('ADM-U8: returns 400 when limit exceeds 50', async () => {
    await supertest(httpServer).get('/v1/admin/users?limit=51').expect(400)
  })

  it('ADM-U9: returns 400 when offset is negative', async () => {
    await supertest(httpServer).get('/v1/admin/users?offset=-1').expect(400)
  })
})
