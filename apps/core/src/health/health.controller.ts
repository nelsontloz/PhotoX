import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

// `/healthz` is the probe alias: the same unversioned handler serves both paths, so the
// status and body cannot drift. Unversioned only — no `api/v1/healthz`.
@Controller(['health', 'healthz'])
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Always 200; the payload carries `degraded`. Kept because existing probes read it. */
  @Get()
  check() {
    return this.healthService.check();
  }
}
