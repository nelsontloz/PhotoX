import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Always 200; the payload carries `degraded`. Kept because existing probes read it. */
  @Get()
  check() {
    return this.healthService.check();
  }

  /** Liveness: the process is up and serving. Never depends on a downstream. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: 503 when a dependency is down, so a probe can act on it. Handler-thrown 503s would
   * log as errors on every probe interval, hence the passthrough status.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const health = await this.healthService.check();
    res.status(health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return health;
  }
}
