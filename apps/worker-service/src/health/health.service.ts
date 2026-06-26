import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { BullMqService } from '../queue/bullmq.service'

@Injectable()
export class HealthService {
  constructor(private readonly bullMq: BullMqService) {}

  async check() {
    const checks: Record<string, string> = {}

    try {
      const ok = await this.bullMq.isHealthy()
      checks.queue = ok ? 'ok' : 'down'
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
