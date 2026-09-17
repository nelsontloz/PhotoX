import { Injectable } from '@nestjs/common'
import { loadEnv } from '@photox/shared-config'

@Injectable()
export class HealthService {
  private readonly coreBaseUrl: string

  constructor() {
    this.coreBaseUrl = loadEnv().CORE_BASE_URL
  }

  async check() {
    const checks: Record<string, { status: string; latencyMs?: number }> = {}

    const coreStart = Date.now()
    try {
      const res = await fetch(`${this.coreBaseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      checks.core = {
        status: res.ok ? 'up' : 'down',
        latencyMs: Date.now() - coreStart,
      }
    } catch {
      checks.core = { status: 'down', latencyMs: Date.now() - coreStart }
    }

    const allUp = Object.values(checks).every((c) => c.status === 'up')
    return {
      status: allUp ? 'ok' : 'degraded',
      service: 'gateway',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    }
  }
}
