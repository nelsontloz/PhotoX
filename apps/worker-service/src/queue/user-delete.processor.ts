import { Logger } from '@nestjs/common'
import { USER_DELETE_QUEUE } from '@photox/shared-types'
import { bindingOf, parseJobData, userDeleteJobSchema, type UserDeleteJob } from './job-schemas'
import type { ProcessorDeps, ProcessorSpec } from './processor-spec'

/**
 * Consumer for the `user-delete` queue (core only produces it). The wipe itself runs in
 * core — this process has no DB or storage access — so the job drains the user's pending
 * media jobs and asks core to purge the account.
 */
export function userDeleteProcessor({
  bullMq,
  core,
}: Pick<ProcessorDeps, 'bullMq' | 'core'>): ProcessorSpec<UserDeleteJob> {
  const logger = new Logger('UserDeleteProcessor')

  return {
    queue: USER_DELETE_QUEUE,
    logger,
    listening: 'User-delete processor listening for jobs',
    run: async (job) => {
      const data = parseJobData(userDeleteJobSchema, job.data, USER_DELETE_QUEUE)
      // jobs enqueued between the admin request and now are caught here; core's rows are still
      // present, so a job the drain misses simply fails closed (404 -> UnrecoverableError)
      await bullMq.drainUserJobs(data.userId)
      await core.purgeUser(data.userId, data.backupPrefix, bindingOf(data))
      logger.log(`User-delete completed: user=${data.userId}`)
    },
  }
}
