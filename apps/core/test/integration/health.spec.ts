import { Test } from '@nestjs/testing'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import type { Express } from 'express'
import type { INestApplication } from '@nestjs/common'
import { AuthModule } from '../../src/auth/auth.module'
import { HealthModule } from '../../src/health/health.module'
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

  beforeAll(async () => {
    const { pgHost, pgPort } = await setupTestInfra()
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
        HealthModule,
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  }, 120_000)

  afterAll(async () => {
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
