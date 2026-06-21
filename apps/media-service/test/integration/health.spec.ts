import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp } from './helpers'

interface HealthResponse {
  status: string
  service: string
  uptime: number
  timestamp: string
  checks: {
    database: { status: string; latencyMs?: number }
    redis: { status: string; latencyMs?: number }
  }
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /health', () => {
  it('HLT-01: returns 503 with status degraded when Redis is unreachable', async () => {
    const res = await supertest(httpServer).get('/health').expect(503)
    const body = res.body as HealthResponse

    expect(body.status).toBe('degraded')
    expect(body.service).toBe('media-service')
  })

  it('HLT-02: database is up, redis is down', async () => {
    const res = await supertest(httpServer).get('/health').expect(503)
    const body = res.body as HealthResponse

    expect(body.checks.database.status).toBe('up')
    expect(body.checks.redis.status).toBe('down')
  })

  it('HLT-03: latencyMs is a number for both checks', async () => {
    const res = await supertest(httpServer).get('/health').expect(503)
    const body = res.body as HealthResponse

    expect(typeof body.checks.database.latencyMs).toBe('number')
    expect(typeof body.checks.redis.latencyMs).toBe('number')
  })

  it('HLT-04: uptime is a number and timestamp is ISO-8601', async () => {
    const res = await supertest(httpServer).get('/health').expect(503)
    const body = res.body as HealthResponse

    expect(typeof body.uptime).toBe('number')
    expect(typeof body.timestamp).toBe('string')
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp)
  })
})
