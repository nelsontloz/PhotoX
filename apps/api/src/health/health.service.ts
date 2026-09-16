import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import Redis from 'ioredis'
import { loadEnv } from '@photox/shared-config'

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

    const redisStart = Date.now()
    const env = loadEnv()
    const redis = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    })
    try {
      const pong = await redis.ping()
      checks.redis = {
        status: pong === 'PONG' ? 'up' : 'down',
        latencyMs: Date.now() - redisStart,
      }
    } catch {
      checks.redis = { status: 'down', latencyMs: Date.now() - redisStart }
    } finally {
      redis.disconnect()
    }

    const allUp = Object.values(checks).every((c) => c.status === 'up')
    return {
      status: allUp ? 'ok' : 'degraded',
      service: 'api',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    }
  }
}
