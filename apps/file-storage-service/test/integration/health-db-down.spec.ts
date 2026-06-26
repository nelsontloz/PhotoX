import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { setupTestInfra, teardownTestInfra } from './test-setup'
import { DatabaseModule } from '../../src/database/database.module'
import { HealthModule } from '../../src/health/health.module'
import { MinioService } from '../../src/storage/minio.service'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'

interface HealthResponse {
  status: string
  service: string
  uptime: number
  timestamp: string
  checks: {
    database: { status: string; latencyMs?: number }
    minio: { status: string; latencyMs?: number }
  }
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  await setupTestInfra()

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      DatabaseModule.forRoot('files_db'),
      HealthModule,
    ],
  })
    .overrideProvider(DataSource)
    .useValue({
      query: () => Promise.reject(new Error('simulated db down')),
    })
    .overrideProvider(MinioService)
    .useValue({
      ping: () => Promise.resolve(),
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
  it('UC-H5: returns 200 with status degraded, database down, minio up', async () => {
    const res = await supertest(httpServer).get('/health').expect(200)
    const body = res.body as HealthResponse

    expect(body.status).toBe('degraded')
    expect(body.service).toBe('file-storage-service')
    expect(body.checks.database.status).toBe('down')
    expect(body.checks.minio.status).toBe('up')
    expect(typeof body.checks.database.latencyMs).toBe('number')
  })
})
