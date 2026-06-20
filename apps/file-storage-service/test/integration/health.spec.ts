import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { stopMinioContainer } from './test-setup'
import { createTestApp, closeTestApp } from './helpers'

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
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /health', () => {
  it('HLT-01: returns 200 with ok status when DB and MinIO are up', async () => {
    const res = await supertest(httpServer).get('/health').expect(200)
    const body = res.body as HealthResponse

    expect(body.status).toBe('ok')
    expect(body.service).toBe('file-storage-service')
    expect(body.checks.database.status).toBe('up')
    expect(body.checks.minio.status).toBe('up')
  })

  it('HLT-02: includes uptime and timestamp', async () => {
    const res = await supertest(httpServer).get('/health').expect(200)
    const body = res.body as HealthResponse

    expect(typeof body.uptime).toBe('number')
    expect(typeof body.timestamp).toBe('string')
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp)
  })

  it('HLT-03: reports latencyMs for both checks', async () => {
    const res = await supertest(httpServer).get('/health').expect(200)
    const body = res.body as HealthResponse

    expect(typeof body.checks.database.latencyMs).toBe('number')
    expect(typeof body.checks.minio.latencyMs).toBe('number')
  })

  it('HLT-04: returns degraded when MinIO is down and DB is still up', async () => {
    await stopMinioContainer()

    const res = await supertest(httpServer).get('/health').expect(200)
    const body = res.body as HealthResponse

    expect(body.status).toBe('degraded')
    expect(body.checks.database.status).toBe('up')
    expect(body.checks.minio.status).toBe('down')
  })
})
