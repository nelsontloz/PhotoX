import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ConflictException } from '@nestjs/common';
import { vi } from 'vitest';
import { In } from 'typeorm';
import { originalKey } from '@photox/shared-config';
import { BackupRun } from '../../src/database/entities/backup-run.entity';
import {
  BACKUP_TRANSFER_QUEUE,
  RESTORE_TRANSFER_QUEUE,
  type TransferJobData,
} from '../../src/backup/backup-transfer.constants';
import { runTransferItem } from '../../../worker-service/src/queue/transfer.worker';
import {
  closeBackupTestApp,
  createBackupTestApp,
  t,
  resetBackupDb,
  runBackup,
  runTransfersOnce,
  seedOriginal,
  transferStore,
  wipeUserData,
} from './helpers/user-backup';

describe('user backup round-trip', () => {
  // 120s: boots its own Postgres pool from the run's template database
  beforeAll(createBackupTestApp, 120_000);
  afterAll(closeBackupTestApp);
  beforeEach(resetBackupDb);

  describe('queued transfers', () => {
    beforeEach(async () => {
      await t.bullMq.redis.flushdb();
    });

    async function takeJob(queueName: string): Promise<TransferJobData> {
      const jobs = await t.bullMq.getQueue(queueName).getJobs(['waiting', 'delayed']);
      expect(jobs).toHaveLength(1);
      const job = jobs[0]!;
      await job.remove();
      return job.data as TransferJobData;
    }

    async function queuedItemCount(runId: string): Promise<number> {
      const rows = await t.dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM backup_run_items WHERE "runId" = $1',
        [runId],
      );
      return rows[0]?.count ?? 0;
    }

    it('dispatches a backup item to the backup queue and consumes it to completion', async () => {
      const email = `queue-backup-${randomUUID()}@example.com`;
      const user = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Backup',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-backup-bytes'));

      const photo = await t.fileRepo.findOneOrFail({ where: { userId: user.id } });
      const { runId } = await t.svc.startBackup(user.id);
      expect(await t.svc.dispatchPendingTransfers('backup', 10)).toBe(1);
      const data = await takeJob(BACKUP_TRANSFER_QUEUE);
      expect(await t.bullMq.getQueue(RESTORE_TRANSFER_QUEUE).getJobs(['waiting'])).toHaveLength(0);
      // the job carries the run owner: it is also the binding `sub` core scopes the call by
      expect(data.userId).toBe(user.id);

      const claim = await t.svc.claimTransfer('backup', data.userId, data.runId, data.itemId, 1);
      const key = originalKey(email, user.id, photo.id, 'bin');
      expect(claim).toMatchObject({ kind: 'backup', s3Key: key });

      await runTransferItem(claim!, { storage: t.storage, store: transferStore() });
      await t.svc.finishTransfer('backup', data.userId, data.runId, data.itemId, {
        attempt: 1,
        ok: true,
      });

      expect((await t.svc.getRunStatus(runId)).state).toBe('completed');
      expect(await queuedItemCount(runId)).toBe(0);
      expect(t.fake.objects.has(key)).toBe(true);
    });

    it('dispatches a restore to the restore queue only and restores the bytes', async () => {
      const email = `queue-restore-${randomUUID()}@example.com`;
      const user = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Restore',
        }),
      );
      const photo = await seedOriginal(user.id, Buffer.from('queue-restore-bytes'));
      await runBackup(user.id);
      await wipeUserData();

      const { runId } = await t.svc.startRestore(user.id);
      expect(await t.svc.dispatchPendingTransfers('restore', 10)).toBe(1);
      const data = await takeJob(RESTORE_TRANSFER_QUEUE);
      expect(await t.bullMq.getQueue(BACKUP_TRANSFER_QUEUE).getJobs(['waiting'])).toHaveLength(0);
      expect(data.userId).toBe(user.id);

      const claim = await t.svc.claimTransfer('restore', data.userId, data.runId, data.itemId, 1);
      expect(claim).toMatchObject({ kind: 'restore' });

      await runTransferItem(claim!, { storage: t.storage, store: transferStore() });
      await t.svc.finishTransfer('restore', data.userId, data.runId, data.itemId, {
        attempt: 1,
        ok: true,
      });

      expect((await t.svc.getRunStatus(runId)).state).toBe('completed');
      const restored = await t.fileRepo.findOneOrFail({ where: { id: photo.record.id } });
      expect(await readFile(t.storage.pathFor(restored.storageKey))).toEqual(photo.bytes);
    });

    it('ignores a job delivered to the wrong queue', async () => {
      const user = await t.userRepo.save(
        t.userRepo.create({
          email: `queue-wrong-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Wrong',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-wrong-bytes'));
      const { runId } = await t.svc.startBackup(user.id);
      await t.svc.dispatchPendingTransfers('backup', 10);
      const data = await takeJob(BACKUP_TRANSFER_QUEUE);

      // the claim is bound to the run's kind, so a misrouted job can never settle it
      expect(
        await t.svc.claimTransfer('restore', data.userId, data.runId, data.itemId, 1),
      ).toBeNull();

      expect(await queuedItemCount(runId)).toBe(1);
      expect((await t.svc.getRunStatus(runId)).state).toBe('running');
    });

    it('retries a transient failure through the queue and finishes on the second attempt', async () => {
      const user = await t.userRepo.save(
        t.userRepo.create({
          email: `queue-retry-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Retry',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-retry-bytes'));
      const { runId } = await t.svc.startBackup(user.id);
      await t.svc.dispatchPendingTransfers('backup', 10);
      const data = await takeJob(BACKUP_TRANSFER_QUEUE);

      t.fake.failNextPuts = 1;
      const first = await t.svc.claimTransfer('backup', data.userId, data.runId, data.itemId, 1);
      await expect(
        runTransferItem(first!, { storage: t.storage, store: transferStore() }),
      ).rejects.toThrow('injected putFile failure');

      const settled = await t.svc.finishTransfer('backup', data.userId, data.runId, data.itemId, {
        attempt: 1,
        ok: false,
        errorCode: 'Error',
        errorMessage: 'injected putFile failure',
      });
      expect(settled).toEqual({ retry: true });
      const queued = await t.dataSource.query<{ state: string }[]>(
        'SELECT "state" FROM backup_run_items WHERE "id" = $1',
        [data.itemId],
      );
      expect(queued[0]?.state).toBe('queued');

      const second = await t.svc.claimTransfer('backup', data.userId, data.runId, data.itemId, 2);
      await runTransferItem(second!, { storage: t.storage, store: transferStore() });
      await t.svc.finishTransfer('backup', data.userId, data.runId, data.itemId, {
        attempt: 2,
        ok: true,
      });
      expect((await t.svc.getRunStatus(runId)).state).toBe('completed');
    });

    it('pauses the run on a local disk failure without retrying the job', async () => {
      const email = `queue-disk-${randomUUID()}@example.com`;
      const user = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Disk',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-disk-bytes'));
      await runBackup(user.id);
      await wipeUserData();
      const { runId } = await t.svc.startRestore(user.id);
      await t.svc.dispatchPendingTransfers('restore', 10);
      const data = await takeJob(RESTORE_TRANSFER_QUEUE);

      const claim = await t.svc.claimTransfer('restore', data.userId, data.runId, data.itemId, 1);
      const noSpace = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      const save = vi.spyOn(t.storage, 'save').mockRejectedValueOnce(noSpace);
      try {
        await expect(
          runTransferItem(claim!, { storage: t.storage, store: transferStore() }),
        ).rejects.toThrow('no space left on device');
      } finally {
        save.mockRestore();
      }

      const settled = await t.svc.finishTransfer('restore', data.userId, data.runId, data.itemId, {
        attempt: 1,
        ok: false,
        errorCode: 'ENOSPC',
        errorMessage: 'no space left on device',
      });
      expect(settled).toEqual({ retry: false });
      expect((await t.svc.getRunStatus(runId)).state).toBe('paused');
      expect(await queuedItemCount(runId)).toBe(1);
    });

    it('treats a repeated finish after success as a no-op', async () => {
      const user = await t.userRepo.save(
        t.userRepo.create({
          email: `queue-again-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Again',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-again-bytes'));
      const { runId } = await t.svc.startBackup(user.id);
      await t.svc.dispatchPendingTransfers('backup', 10);
      const data = await takeJob(BACKUP_TRANSFER_QUEUE);

      const claim = await t.svc.claimTransfer('backup', data.userId, data.runId, data.itemId, 1);
      await runTransferItem(claim!, { storage: t.storage, store: transferStore() });
      await t.svc.finishTransfer('backup', data.userId, data.runId, data.itemId, {
        attempt: 1,
        ok: true,
      });
      const uploaded = async (): Promise<number | undefined> =>
        (
          await t.dataSource.query<{ uploaded: number }[]>(
            'SELECT "uploaded" FROM backup_runs WHERE "id" = $1',
            [runId],
          )
        )[0]?.uploaded;
      expect(await uploaded()).toBe(1);

      const again = await t.svc.finishTransfer('backup', data.userId, data.runId, data.itemId, {
        attempt: 1,
        ok: true,
      });
      expect(again).toEqual({ retry: false });
      expect((await t.svc.getRunStatus(runId)).state).toBe('completed');
      expect(await uploaded()).toBe(1);
    });

    it('refuses a finish reported for the wrong kind', async () => {
      const user = await t.userRepo.save(
        t.userRepo.create({
          email: `queue-kind-${randomUUID()}@example.com`,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Queue Kind',
        }),
      );
      await seedOriginal(user.id, Buffer.from('queue-kind-bytes'));
      const { runId } = await t.svc.startBackup(user.id);
      await t.svc.dispatchPendingTransfers('backup', 10);
      const data = await takeJob(BACKUP_TRANSFER_QUEUE);

      const res = await t.svc.finishTransfer('restore', data.userId, data.runId, data.itemId, {
        attempt: 1,
        ok: true,
      });

      expect(res).toEqual({ retry: false });
      expect(await queuedItemCount(runId)).toBe(1);
      expect((await t.svc.getRunStatus(runId)).state).toBe('running');
    });
  });

  // Two POSTs (double click, two tabs, an auto-retry) both pass `assertNoActiveRun`, a plain
  // findOne with no lock or unique rule behind it, and then write into the same fixed prefix.
  describe('concurrent starts for one user (fails first)', () => {
    it('accepts exactly one of two simultaneous starts', async () => {
      const email = `race-start-${randomUUID()}@example.com`;
      const user = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Race Start',
        }),
      );
      await seedOriginal(user.id, Buffer.from('race-start-bytes'));

      // launched in the same tick: both read "no active run" before either inserts
      const settled = await Promise.allSettled([
        t.svc.startBackup(user.id),
        t.svc.startBackup(user.id),
      ]);

      const refused = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      const activeRuns = await t.dataSource.getRepository(BackupRun).count({
        where: { userId: user.id, state: In(['running', 'paused', 'finalizing']) },
      });

      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.reason).toBeInstanceOf(ConflictException);
      expect(activeRuns).toBe(1);
    });

    it('does not prune bytes uploaded for a file created after its snapshot', async () => {
      const email = `race-prune-${randomUUID()}@example.com`;
      const user = await t.userRepo.save(
        t.userRepo.create({
          email,
          role: 'user',
          passwordHash: 'test-hash',
          displayName: 'Race Prune',
        }),
      );
      const a = await seedOriginal(user.id, Buffer.from('race-prune-a'));
      await t.assetRepo.save(
        t.assetRepo.create({
          userId: user.id,
          kind: 'photo',
          fileId: a.record.id,
          isTrashed: false,
        }),
      );

      const { runId } = await t.svc.startBackup(user.id);
      expect((await t.svc.getRunStatus(runId)).state).toBe('running');

      // The second start uploads a new file into the same prefix after the first run took
      // its file list. The prune compares S3 against that frozen snapshot, not the DB.
      const b = await seedOriginal(user.id, Buffer.from('race-prune-b'));
      await t.assetRepo.save(
        t.assetRepo.create({
          userId: user.id,
          kind: 'photo',
          fileId: b.record.id,
          isTrashed: false,
        }),
      );
      const keyB = originalKey(email, user.id, b.record.id, 'bin');
      await t.fake.putObject(keyB, Buffer.from('race-prune-b'));

      for (let i = 0; i < 20; i++) {
        if ((await t.svc.getRunStatus(runId)).state !== 'running') break;
        await runTransfersOnce();
      }
      expect((await t.svc.getRunStatus(runId)).state).toBe('completed');

      // b has a live file row, so its bytes belong to the user: the prune must not delete them
      expect(t.fake.objects.has(keyB)).toBe(true);
    });
  });
});
