import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { parseJobData, cleanupJobSchema, type CleanupJob } from './job-schemas'
import { CoreClient } from '../core/core-client.service'

@Injectable()
export class CleanupProcessor implements OnModuleInit {
  private readonly logger = new Logger(CleanupProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
  ) {}

  onModuleInit() {
    this.bullMq.createWorker<CleanupJob>('cleanup-asset', (job) => this.processJob(job), {
      concurrency: 5,
    })

    this.logger.log('Cleanup processor listening for jobs')
  }

  private async processJob(job: Job<CleanupJob>) {
    const { fileId } = parseJobData(cleanupJobSchema, job.data, 'cleanup-asset')

    // endpoint deletes blob + row and is idempotent (204 even when missing)
    await this.core.adminDeleteFile(fileId)
    this.logger.log(`Cleanup complete: file=${fileId}`)
  }
}
