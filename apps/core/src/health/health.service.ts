import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { BullMqService } from '../queue/bullmq.service'

// BullMQ's client queues commands while Redis is unreachable (maxRetriesPerRequest: null),
// so the probe is capped — a dead Redis must degrade the payload, not hang the endpoint
const REDIS_PING_TIMEOUT_MS = 1000

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
  ) {}

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
    let timer: NodeJS.Timeout | undefined
    try {
      const pong = await Promise.race([
        this.bullMq.redis.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('redis ping timed out')), REDIS_PING_TIMEOUT_MS)
        }),
      ])
      checks.redis = {
        status: pong === 'PONG' ? 'up' : 'down',
        latencyMs: Date.now() - redisStart,
      }
    } catch {
      checks.redis = { status: 'down', latencyMs: Date.now() - redisStart }
    } finally {
      clearTimeout(timer)
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
}
