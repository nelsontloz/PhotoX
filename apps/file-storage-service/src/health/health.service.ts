import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { RedisService } from '@photox/shared-redis'
import { MinioService } from '../storage/minio.service'

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly minio: MinioService,
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
    try {
      await this.redis.ping()
      checks.redis = { status: 'up', latencyMs: Date.now() - redisStart }
    } catch {
      checks.redis = { status: 'down', latencyMs: Date.now() - redisStart }
    }

    const minioStart = Date.now()
    try {
      await this.minio.ping()
      checks.minio = { status: 'up', latencyMs: Date.now() - minioStart }
    } catch {
      checks.minio = { status: 'down', latencyMs: Date.now() - minioStart }
    }

    const allUp = Object.values(checks).every((c) => c.status === 'up')
    return {
      status: allUp ? 'ok' : 'degraded',
      service: 'file-storage-service',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    }
  }
}
