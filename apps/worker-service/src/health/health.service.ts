import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { PgBossService } from '../queue/pg-boss.service'

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly pgBoss: PgBossService,
  ) {}

  async check() {
    const checks: Record<string, string> = {}

    // Database check
    try {
      await this.dataSource.query('SELECT 1')
      checks.database = 'ok'
    } catch {
      checks.database = 'error'
    }

    // Queue check
    try {
      const isConnected = this.pgBoss.isConnected()
      checks.queue = isConnected ? 'ok' : 'disconnected'
    } catch {
      checks.queue = 'error'
    }

    const healthy = Object.values(checks).every((s) => s === 'ok')

    if (!healthy) {
      throw new ServiceUnavailableException({
        status: 'unhealthy',
        service: 'worker-service',
        checks,
      })
    }

    return {
      status: 'ok',
      service: 'worker-service',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    }
  }
}
