import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { setupTestInfra, teardownTestInfra } from './test-setup'
import { DatabaseModule } from '../../src/database/database.module'
import { HealthModule } from '../../src/health/health.module'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'

interface HealthResponse {
  status: string
  service: string
  uptime: number
  timestamp: string
  checks: {
    database: { status: string; latencyMs?: number }
  }
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  await setupTestInfra()

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      DatabaseModule.forRoot('library_db'),
      HealthModule,
    ],
  })
    .overrideProvider(DataSource)
    .useValue({
      query: () => Promise.reject(new Error('simulated db down')),
    })
    .compile()

  app = module.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.init()
  httpServer = app.getHttpServer() as Server
}, 120_000)

afterAll(async () => {
  await app?.close()
  await teardownTestInfra()
})

describe('GET /health — DB down', () => {
  it('UC-H2: returns 503 with status degraded and database down', async () => {
    const res = await supertest(httpServer).get('/health').expect(503)
    const body = res.body as HealthResponse

    expect(body.status).toBe('degraded')
    expect(body.service).toBe('media-service')
    expect(body.checks.database.status).toBe('down')
    expect(typeof body.checks.database.latencyMs).toBe('number')
  })
})
