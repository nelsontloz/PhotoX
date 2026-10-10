import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { BullMqService } from '../queue/bullmq.service'

@Injectable()
export class HealthService {
  constructor(private readonly bullMq: BullMqService) {}

  async check() {
    // isHealthy() swallows ping errors and resolves false — no catch needed here
    const queue = (await this.bullMq.isHealthy()) ? 'ok' : 'down'

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
