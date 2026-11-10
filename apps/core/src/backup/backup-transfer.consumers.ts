import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { loadEnv } from '@photox/shared-config';
import { Worker } from 'bullmq';
import {
  TRANSFER_CONCURRENCY,
  TRANSFER_QUEUES,
  type TransferKind,
} from './backup-transfer.constants';
import { UserBackupService } from './user-backup.service';

/**
 * Consumer half of the backup/restore queues. One worker per queue means a restore backlog can
 * never starve a backup (and vice versa); each worker owns its own blocking Redis connection.
 * The processor is intentionally thin: UserBackupService re-reads the run/item from the DB and
 * decides success/retry/permanent failure.
 */
@Injectable()
export class BackupTransferConsumers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupTransferConsumers.name);
  private workers: Worker[] = [];

  constructor(private readonly backups: UserBackupService) {}

  onModuleInit(): void {
    // integration specs drive the same runs synchronously; a live worker would race them
    if (process.env.NODE_ENV === 'test') return;
    const env = loadEnv();
    // BullMQ needs maxRetriesPerRequest: null on a blocking connection; give each worker its own.
    const connection = {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      maxRetriesPerRequest: null,
    };
    for (const kind of Object.keys(TRANSFER_QUEUES) as TransferKind[]) {
      const worker = new Worker(
        TRANSFER_QUEUES[kind],
        (job) => this.backups.consumeTransferJob(kind, job),
        {
          connection,
          concurrency: TRANSFER_CONCURRENCY[kind],
        },
      );
      worker.on('failed', (job, err) =>
        this.logger.warn(`[${kind}-transfer] job ${job?.id ?? '?'} failed: ${err.message}`),
      );
      worker.on('error', (err) =>
        this.logger.error(`[${kind}-transfer] worker error: ${err.message}`),
      );
      this.workers.push(worker);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.workers = [];
  }
}
