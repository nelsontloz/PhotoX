import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  async check() {
    const checks: Record<string, { status: string; latencyMs?: number }> = {}

    const dbStart = Date.now()
    try {
      await this.dataSource.query('SELECT 1')
      checks.database = { status: 'up', latencyMs: Date.now() - dbStart }
    } catch {
      checks.database = { status: 'down', latencyMs: Date.now() - dbStart }
    }

    const allUp = Object.values(checks).every((c) => c.status === 'up')
    return {
      status: allUp ? 'ok' : 'degraded',
      service: 'user-service',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    }
  }
}
