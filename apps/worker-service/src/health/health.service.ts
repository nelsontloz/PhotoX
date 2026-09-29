import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { BullMqService } from '../queue/bullmq.service'

@Injectable()
export class HealthService {
  constructor(private readonly bullMq: BullMqService) {}

  async check() {
    let queue: string
    try {
      queue = (await this.bullMq.isHealthy()) ? 'ok' : 'down'
    } catch {
      queue = 'error'
    }

    if (queue !== 'ok') {
      throw new ServiceUnavailableException({
        status: 'unhealthy',
        service: 'worker-service',
        checks: { queue },
      })
    }

    return {
      status: 'ok',
      service: 'worker-service',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: { queue },
    }
  }
}
