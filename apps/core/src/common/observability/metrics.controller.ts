import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // Open route (see auth/open-routes.ts): a Prometheus scraper carries no session. The body is
  // counters over route templates only — no user ids, paths or payloads.
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): string {
    return this.metrics.render();
  }
}
