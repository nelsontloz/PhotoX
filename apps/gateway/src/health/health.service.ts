import { Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'

const SERVICES = {
  'user-service': process.env.USER_SERVICE_URL ?? 'http://localhost:3001',
  'media-service': process.env.MEDIA_SERVICE_URL ?? 'http://localhost:3002',
  'file-storage-service': process.env.FILE_STORAGE_SERVICE_URL ?? 'http://localhost:3003',
} as const

@Injectable()
export class HealthService {
  constructor(private readonly http: HttpService) {}

  async check() {
    const checks: Record<string, { status: string; latencyMs?: number }> = {}

    const entries = Object.entries(SERVICES)
    await Promise.allSettled(
      entries.map(async ([name, url]) => {
        const start = Date.now()
        try {
          await firstValueFrom(this.http.get(`${url}/health`, { timeout: 5000 }))
          checks[name] = { status: 'up', latencyMs: Date.now() - start }
        } catch {
          checks[name] = { status: 'down', latencyMs: Date.now() - start }
        }
      }),
    )

    const allUp = Object.values(checks).every((c) => c.status === 'up')
    const anyDown = Object.values(checks).some((c) => c.status === 'down')

    return {
      status: allUp ? 'ok' : anyDown ? 'down' : 'degraded',
      service: 'gateway',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    }
  }
}
