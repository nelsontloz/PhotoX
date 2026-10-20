import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { UnrecoverableError, type Job } from 'bullmq'
import type { UserDeleteJobData } from '@photox/shared-types'
import { BullMqService } from '../../queue/bullmq.service'
import { USER_DELETE_QUEUE, UserDeleteService, userDeleteJobSchema } from './user-delete.service'

/**
 * Core-side consumer for the `user-delete` queue. Runs in core (not the
 * worker-service) because deletion needs direct DB + storage access and the
 * worker-service must never gain DB access.
 */
@Injectable()
export class UserDeleteProcessor implements OnModuleInit {
  private readonly logger = new Logger(UserDeleteProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly deletes: UserDeleteService,
  ) {}

  onModuleInit(): void {
    this.bullMq.createWorker<UserDeleteJobData>(USER_DELETE_QUEUE, (job) => this.processJob(job))
    this.logger.log('User-delete processor listening for jobs')
  }

  private async processJob(job: Job<UserDeleteJobData>): Promise<void> {
    const parsed = userDeleteJobSchema.safeParse(job.data)
    if (!parsed.success) {
      // invalid payload would fail the same way on every retry — drop it
      throw new UnrecoverableError(`Invalid user-delete job payload: ${parsed.error.message}`)
    }
    const { userId, backupPrefix } = parsed.data
    this.deletes.setProgress(userId, 'active', job.id ?? userId, backupPrefix)
    try {
      // jobs enqueued between the enqueue-time drain and now are caught here
      await this.deletes.drainUserJobs(userId)
      await this.deletes.runUserDelete(userId, backupPrefix)
    } catch (err) {
      this.deletes.setProgress(userId, 'failed')
      throw err
    }
  }
}
