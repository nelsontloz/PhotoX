import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { Job } from 'bullmq'
import { USER_DELETE_QUEUE } from '@photox/shared-types'
import { BullMqService } from './bullmq.service'
import { bindingOf, parseJobData, userDeleteJobSchema, type UserDeleteJob } from './job-schemas'
import { CoreClient } from '../core/core-client.service'

/**
 * Consumer for the `user-delete` queue (core only produces it). The wipe itself runs in
 * core — this process has no DB or storage access — so the job drains the user's pending
 * media jobs and asks core to purge the account.
 */
@Injectable()
export class UserDeleteProcessor implements OnModuleInit {
  private readonly logger = new Logger(UserDeleteProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
  ) {}

  onModuleInit() {
    this.bullMq.createWorker<UserDeleteJob>(USER_DELETE_QUEUE, (job) => this.processJob(job))
    this.logger.log('User-delete processor listening for jobs')
  }

  private async processJob(job: Job<UserDeleteJob>) {
    const data = parseJobData(userDeleteJobSchema, job.data, USER_DELETE_QUEUE)
    // jobs enqueued between the admin request and now are caught here; core's rows are still
    // present, so a job the drain misses simply fails closed (404 -> UnrecoverableError)
    await this.bullMq.drainUserJobs(data.userId)
    await this.core.purgeUser(data.userId, data.backupPrefix, bindingOf(data))
    this.logger.log(`User-delete completed: user=${data.userId}`)
  }
}
