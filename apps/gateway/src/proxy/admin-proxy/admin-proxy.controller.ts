import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { BullMqService } from '../../queue/bullmq.service'
import { AdminGuard } from '../../auth/admin.guard'

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('api/v1/admin')
export class AdminProxyController {
  constructor(private readonly bullmq: BullMqService) {}

  @Post('cleanup-orphans')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue an orphan file/thumbnail cleanup job' })
  @ApiResponse({ status: 202, description: 'Job enqueued' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  cleanupOrphans(@Body() body?: { dryRun?: boolean }) {
    const dryRun = body?.dryRun ?? false
    void this.bullmq.enqueue(
      'cleanup-orphans',
      'cleanup-orphans',
      { dryRun },
      { jobId: `orphan-cleanup-${Date.now()}` },
    )
    return { enqueued: true, dryRun }
  }
}
