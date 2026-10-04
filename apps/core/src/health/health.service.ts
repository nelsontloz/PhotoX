import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { DataSource } from 'typeorm'
import Redis from 'ioredis'
import { loadEnv } from '@photox/shared-config'

@Injectable()
export class HealthService implements OnModuleDestroy {
  private redis?: Redis

  constructor(private readonly dataSource: DataSource) {}

  // ponytail: one client per process instead of one per check; ping latency is the signal we keep
  private getRedis(): Redis {
    if (!this.redis) {
      const env = loadEnv()
      this.redis = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
      })
      // ioredis reconnects on its own; ping() surfaces failures, so don't let error events bubble
      this.redis.on('error', () => undefined)
    }
    return this.redis
  }

  async check() {
    const checks: Record<string, { status: string; latencyMs?: number }> = {}

    const dbStart = Date.now()
    try {
      await this.dataSource.query('SELECT 1')
      checks.database = { status: 'up', latencyMs: Date.now() - dbStart }
    } catch {
      checks.database = { status: 'down', latencyMs: Date.now() - dbStart }
    }

    const redisStart = Date.now()
    try {
      const pong = await this.getRedis().ping()
      checks.redis = {
        status: pong === 'PONG' ? 'up' : 'down',
        latencyMs: Date.now() - redisStart,
      }
    } catch {
      checks.redis = { status: 'down', latencyMs: Date.now() - redisStart }
    }

    const allUp = Object.values(checks).every((c) => c.status === 'up')
    return {
      status: allUp ? 'ok' : 'degraded',
      service: 'core',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect()
  }
}
