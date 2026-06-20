import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { setupTestInfra, teardownTestInfra } from './test-setup'

interface HealthResponse {
  status: string
  service: string
  uptime: number
  timestamp: string
  checks: {
    database: { status: string }
  }
}

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

describe('GET /health', () => {
  it('HLT-01: returns 200 with ok status when DB is up', async () => {
    const res = await supertest(httpServer).get('/health').expect(200)
    const body = res.body as HealthResponse

    expect(body.status).toBe('ok')
    expect(body.service).toBe('user-service')
    expect(body.checks.database.status).toBe('up')
  })

  it('HLT-02: includes uptime and timestamp', async () => {
    const res = await supertest(httpServer).get('/health').expect(200)
    const body = res.body as HealthResponse

    expect(typeof body.uptime).toBe('number')
    expect(typeof body.timestamp).toBe('string')
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp)
  })
})
