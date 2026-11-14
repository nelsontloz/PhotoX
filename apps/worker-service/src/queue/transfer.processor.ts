import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  BACKUP_TRANSFER_QUEUE,
  RESTORE_TRANSFER_QUEUE,
  type TransferClaimResponse,
  type TransferKind,
} from '@photox/shared-types';
import { bindingOf, parseJobData, transferJobSchema, type TransferJob } from './job-schemas';
import type { ProcessorDeps, ProcessorSpec } from './processor-spec';

// core's fail DTO caps the wire message
const ERROR_MAX_LENGTH = 512;
// BullMQ default when the payload carries no attempts (core enqueues 5)
const DEFAULT_MAX_ATTEMPTS = 5;

type ClaimedTransfer = Extract<TransferClaimResponse, { claimed: true }>;

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Consumer half of the backup/restore queues (core only produces them). The ledger stays in
 * core: claim one item, move the bytes here (this process owns STORAGE_DIR and the S3 store),
 * then report complete/fail. A claim is the only licence to write bytes, so a Redis writer can
 * at most re-trigger an item the run already owns.
 */
export function transferProcessor(
  { core, s3, storage }: Pick<ProcessorDeps, 'core' | 's3' | 'storage'>,
  kind: TransferKind,
): ProcessorSpec<TransferJob> {
  const logger = new Logger('TransferProcessor');
  const queue = kind === 'backup' ? BACKUP_TRANSFER_QUEUE : RESTORE_TRANSFER_QUEUE;

  // restores write into STORAGE_DIR, backups only read it, so restores get less width
  const workerOptions = {
    concurrency: kind === 'backup' ? 4 : 2,
    // a multi-GB file outlives BullMQ's 30s default lock, and renewal can lag while ONNX work
    // holds the event loop; a false stall only costs an idempotent re-run, never lost bytes
    lockDuration: 5 * 60_000,
    maxStalledCount: 2,
  };

  async function restoreFile(runId: string, claimed: ClaimedTransfer): Promise<void> {
    const dir = storage.pathFor(join('backup-runs', runId, 'tmp'));
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `${claimed.fileId}.${randomUUID()}.part`);
    try {
      await s3.downloadToFile(claimed.s3Key, tmp);
      if (claimed.checksumSha256) {
        const actual = await sha256File(tmp);
        if (actual !== claimed.checksumSha256) {
          throw new Error(`checksum mismatch for ${claimed.fileId}`);
        }
      }
      // atomic save consumes the temp file; a failure leaves the item retryable
      await storage.save(claimed.storageKey, tmp);
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  return {
    queue,
    workerOptions,
    run: async (job) => {
      const data = parseJobData(transferJobSchema, job.data, queue);
      const binding = bindingOf(data);
      const attempt = job.attemptsMade + 1;

      const claimed = await core.claimTransfer(
        data.userId,
        kind,
        data.runId,
        data.itemId,
        attempt,
        binding,
      );
      // terminal or already-done item (or another attempt owns it): nothing to move
      if (!claimed.claimed) return;

      try {
        if (kind === 'backup') {
          await s3.putFile(
            claimed.s3Key,
            storage.pathFor(claimed.storageKey),
            claimed.mimeType ?? undefined,
          );
        } else {
          await restoreFile(data.runId, claimed);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failure = {
          message: message.slice(0, ERROR_MAX_LENGTH),
          code: (err as NodeJS.ErrnoException).code,
          errorName: (err as { name?: string }).name,
          attempt,
          maxAttempts: job.opts.attempts ?? DEFAULT_MAX_ATTEMPTS,
        };
        const { retry } = await core.failTransfer(
          data.userId,
          kind,
          data.runId,
          data.itemId,
          failure,
          binding,
        );
        logger.warn(
          `Transfer ${retry ? 'retry' : 'failed'} (${kind}) run=${data.runId} item=${data.itemId} ` +
            `attempt=${attempt}: ${message}`,
        );
        // retry=true is core handing the retry to BullMQ's backoff
        if (retry) throw err;
        return;
      }

      // a lost complete is retried by BullMQ: the claim is idempotent and the transfer re-runs
      await core.completeTransfer(data.userId, data.runId, data.itemId, binding);
      logger.log(`Transfer complete (${kind}): run=${data.runId} item=${data.itemId}`);
    },
  };
}
