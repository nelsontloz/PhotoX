import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Always 200; the payload carries `degraded`. Kept because existing probes read it. */
  @Get()
  @ApiOperation({ summary: 'Health check (200 even when degraded)' })
  check() {
    return this.healthService.check();
  }
}
