import { BACKUP_TRANSFER_QUEUE, RESTORE_TRANSFER_QUEUE } from '@photox/shared-types';

// Core both produces and consumes these two queues at the ledger level: it enqueues and claims
// the DB rows, while the worker moves the bytes (it owns STORAGE_DIR and the backup S3 store).
// The DB ledger (backup_runs/backup_run_items) is still the source of truth; the queues are
// only the executor, so a Redis flush delays work but never loses it.
export {
  BACKUP_TRANSFER_QUEUE,
  RESTORE_TRANSFER_QUEUE,
  type TransferJobData,
  type TransferKind,
} from '@photox/shared-types';

export const TRANSFER_QUEUES = {
  backup: BACKUP_TRANSFER_QUEUE,
  restore: RESTORE_TRANSFER_QUEUE,
} as const;

/** Items one dispatcher pass may hand to a queue; keeps the burst and S3/disk load bounded. */
export const TRANSFER_DISPATCH_BATCH_SIZE = 4;
export const TRANSFER_JOB_ATTEMPTS = 5;
export const TRANSFER_JOB_BACKOFF_MS = 1000;
export const TRANSFER_DISPATCH_INTERVAL_MS = 1000;
/** A 'queued' row older than this lost its job (crash, Redis flush); the dispatcher re-adds it. */
export const TRANSFER_QUEUE_LEASE_MS = 5 * 60_000;

// One advisory lock per kind so a slow or paused backup dispatch never stalls restore dispatch.
export const BACKUP_DISPATCH_LOCK_KEY = 728461004;
export const RESTORE_DISPATCH_LOCK_KEY = 728461005;
