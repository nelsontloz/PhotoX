import { Controller, Get, Res, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import type { Response } from 'express'
import { HealthService } from './health.service'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Service health check (DB + Redis)' })
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.check()
    if (result.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE)
    return result
  }
}
