import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { parseJobData, cleanupOrphansJobSchema, type CleanupOrphansJob } from './job-schemas'
import { CoreClient } from '../core/core-client.service'

@Injectable()
export class CleanupOrphansProcessor implements OnModuleInit {
  private readonly logger = new Logger(CleanupOrphansProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
  ) {}

  onModuleInit() {
    this.bullMq.createWorker<CleanupOrphansJob>('cleanup-orphans', (job) => this.processJob(job))
    this.logger.log('Cleanup orphans processor listening for jobs')
  }

  private async processJob(job: Job<CleanupOrphansJob>) {
    parseJobData(cleanupOrphansJobSchema, job.data, 'cleanup-orphans')
    this.logger.log('Orphan cleanup starting')

    const result = await this.core.adminRunOrphanCleanup()

    this.logger.log(
      `Orphan cleanup complete: deleted ${result.deletedFiles} files, ` +
        `${result.deletedThumbnails} thumbnail rows, ${result.deletedStrays} stray disk files`,
    )
  }
}
