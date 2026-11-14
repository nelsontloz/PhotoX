import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Always 200; the payload carries `degraded`. Kept because existing probes read it. */
  @Get()
  check() {
    return this.healthService.check();
  }
}
