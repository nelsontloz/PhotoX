import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { BullMqService } from '../queue/bullmq.service';

@Injectable()
export class HealthService {
  constructor(private readonly bullMq: BullMqService) {}

  async check() {
    // isHealthy() swallows ping errors and resolves false — no catch needed here
    if (!(await this.bullMq.isHealthy())) {
      throw new ServiceUnavailableException({
        status: 'unhealthy',
        service: 'worker-service',
        checks: { queue: 'down' },
      });
    }

    return {
      status: 'ok',
      service: 'worker-service',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: { queue: 'ok' },
    };
  }
}
