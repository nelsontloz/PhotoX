import { Logger } from '@nestjs/common';
import { sweepUserStorage } from '@photox/shared-config';
import { USER_DELETE_QUEUE, type UserDeleteFinishRequest } from '@photox/shared-types';
import { bindingOf, parseJobData, userDeleteJobSchema, type UserDeleteJob } from './job-schemas';
import type { ProcessorDeps, ProcessorSpec } from './processor-spec';

// one bounded transaction per call, so a pause also gives core's DB room between batches
const STEP_DELAY_MS = 150;
// a core bug that never reports `done` must not pin a worker forever
const MAX_STEPS = 10_000;
// core's finish DTO rejects both error fields past this length
const ERROR_MAX_LENGTH = 512;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const clip = (message: string): string => message.slice(0, ERROR_MAX_LENGTH);

/**
 * Consumer for the `user-delete` queue (core only produces it). The rows are wiped by core in
 * bounded steps (this process has no DB access), then the worker sweeps its own storage bytes
 * and reports the terminal state.
 */
export function userDeleteProcessor({
  bullMq,
  core,
  storage,
}: Pick<ProcessorDeps, 'bullMq' | 'core' | 'storage'>): ProcessorSpec<UserDeleteJob> {
  const logger = new Logger('UserDeleteProcessor');

  return {
    queue: USER_DELETE_QUEUE,
    run: async (job) => {
      const data = parseJobData(userDeleteJobSchema, job.data, USER_DELETE_QUEUE);
      const binding = bindingOf(data);
      let reported = false;

      try {
        // jobs enqueued between the admin request and now are caught here; core's rows are still
        // present, so a job the drain misses simply fails closed (404 -> UnrecoverableError)
        await bullMq.drainUserJobs(data.userId);
        logger.log(`User-delete started: user=${data.userId}`);

        for (let steps = 1; ; steps++) {
          if (steps > MAX_STEPS) {
            throw new Error(`User-delete exceeded ${MAX_STEPS} steps: user=${data.userId}`);
          }
          const step = await core.purgeStep(data.userId, data.backupPrefix, binding);
          // progress also renews the BullMQ lock, so a slow step cannot be re-picked mid-flight
          await job.updateProgress({ phase: step.phase, deleted: step.deleted });
          if (step.done) break;
          await delay(STEP_DELAY_MS);
        }

        const sweep = await sweepUserStorage(storage, data.userId);
        const report: UserDeleteFinishRequest = {
          backupPrefix: data.backupPrefix,
          filesDeleted: sweep.deleted,
          filesFailed: sweep.failed,
          ...(sweep.firstError ? { firstError: clip(sweep.firstError) } : {}),
        };
        await core.purgeFinish(data.userId, report, binding);
        reported = true;
        logger.log(
          `User-delete storage swept: user=${data.userId} files=${sweep.deleted} failed=${sweep.failed}`,
        );

        // idempotent to re-sweep: a retry may clear what this attempt could not, and `reported`
        // keeps the catch from overwriting the `partial` state with `failed`
        if (sweep.failed > 0) {
          throw new Error(
            `User-delete left ${sweep.failed} files: user=${data.userId}` +
              (sweep.firstError ? ` — ${sweep.firstError}` : ''),
          );
        }
        logger.log(`User-delete completed: user=${data.userId} files=${sweep.deleted}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // an UnrecoverableError skips the remaining retries, so it is terminal whatever the count
        const lastAttempt =
          job.attemptsMade + 1 >= (job.opts.attempts ?? 1) ||
          (err instanceof Error && err.name === 'UnrecoverableError');
        // without this the durable row would sit on `active` forever once retries run out
        if (lastAttempt && !reported) {
          await core
            .purgeFinish(
              data.userId,
              {
                backupPrefix: data.backupPrefix,
                filesDeleted: 0,
                filesFailed: 0,
                error: clip(message),
              },
              binding,
            )
            .catch((reportErr: unknown) => {
              // the original error must survive; the report is best-effort on a dying attempt
              logger.warn(
                `User-delete failed-report rejected: user=${data.userId} — ${
                  reportErr instanceof Error ? reportErr.message : String(reportErr)
                }`,
              );
            });
        }
        throw err;
      }
    },
  };
}
