// Core both produces and consumes these two queues: the worker-service stays out of backup and
// restore transfers. The DB ledger (backup_runs/backup_run_items) is still the source of truth;
// the queues are only the executor, so a Redis flush delays work but never loses it.
export const BACKUP_TRANSFER_QUEUE = 'backup-transfer';
export const RESTORE_TRANSFER_QUEUE = 'restore-transfer';

export const TRANSFER_QUEUES = {
  backup: BACKUP_TRANSFER_QUEUE,
  restore: RESTORE_TRANSFER_QUEUE,
} as const;

export type TransferKind = keyof typeof TRANSFER_QUEUES;

/** Backups only read local files; restores also write into STORAGE_DIR, so they get less width. */
export const TRANSFER_CONCURRENCY: Record<TransferKind, number> = {
  backup: 4,
  restore: 2,
};

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

/** Payload is ids only — the consumer re-reads the run/item from the DB before doing any I/O. */
export interface TransferJobData {
  runId: string;
  itemId: string;
}
