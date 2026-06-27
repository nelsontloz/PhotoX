import { Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'

@Injectable()
export class HealthService {
  constructor(private readonly http: HttpService) {}

  async check() {
    const checks: Record<string, { status: string; latencyMs?: number }> = {}

    const entries = Object.entries(SERVICE_URLS)
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

    return {
      status: allUp ? 'ok' : 'down',
      service: 'gateway',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    }
  }
}
