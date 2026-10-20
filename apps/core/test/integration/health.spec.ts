import { Test } from '@nestjs/testing'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import type { Express } from 'express'
import type { INestApplication } from '@nestjs/common'
import Redis from 'ioredis'
import { AuthModule } from '../../src/auth/auth.module'
import { HealthModule } from '../../src/health/health.module'
import { BullMqModule } from '../../src/queue/bullmq.module'
import { BullMqService } from '../../src/queue/bullmq.service'
import { setupTestInfra, stopRedisContainer, teardownTestInfra } from './test-setup'

interface HealthBody {
  status: string
  service: string
  uptime: number
  timestamp: string
  checks: Record<string, { status: string; latencyMs?: number }>
}

describe('health endpoint', () => {
  let app: INestApplication
  let redis: Redis

  beforeAll(async () => {
    const { redisHost, redisPort, pgHost, pgPort } = await setupTestInfra()
    // stand in for the global BullMqService's shared client (the real service's
    // onModuleDestroy quit() would hang teardown once this test kills Redis)
    redis = new Redis({ host: redisHost, port: redisPort, maxRetriesPerRequest: null })
    redis.on('error', () => undefined)
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: pgHost,
          port: pgPort,
          username: 'photox',
          password: 'photox',
          database: 'photox',
          synchronize: true,
        }),
        // real global guard, so a non-whitelisted /health would come back 401
        AuthModule,
        BullMqModule,
        HealthModule,
      ],
    })
      .overrideProvider(BullMqService)
      .useValue({ redis })
      .compile()
    app = moduleRef.createNestApplication()
    await app.init()
  }, 120_000)

  afterAll(async () => {
    redis.disconnect()
    await app.close()
    await teardownTestInfra()
  })

  it('GET /health is open and reports Postgres + Redis up', async () => {
    const server = app.getHttpServer() as Express
    const res = await request(server).get('/health')
    expect(res.status).toBe(200)
    const body = res.body as HealthBody
    expect(body.status).toBe('ok')
    expect(body.service).toBe('core')
    expect(typeof body.uptime).toBe('number')
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date')
    expect(body.checks.database?.status).toBe('up')
    expect(body.checks.redis?.status).toBe('up')
  })

  // must stay LAST: this stops the shared Redis container for the rest of the file
  it('reports degraded with Redis down while Postgres stays up', async () => {
    await stopRedisContainer()
    const server = app.getHttpServer() as Express
    const res = await request(server).get('/health')
    expect(res.status).toBe(200)
    const body = res.body as HealthBody
    expect(body.status).toBe('degraded')
    expect(body.service).toBe('core')
    expect(body.checks.database?.status).toBe('up')
    expect(body.checks.redis?.status).toBe('down')
  }, 60_000)
})
