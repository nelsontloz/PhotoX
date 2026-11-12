import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import type { BackupRun } from './entities/backup-run.entity';
import type { BackupRunItem } from './entities/backup-run-item.entity';
import { UserBackupService } from './user-backup.service';

const USER = '11111111-1111-4111-8111-111111111111';

function makeService(opts: { paused: Partial<BackupRun> | null; ensureBucket?: () => Promise<void> }) {
  const users = { findOne: vi.fn(() => Promise.resolve({ id: USER, email: 'ada@example.com' })) };
  const runs = {
    findOne: vi.fn(() => Promise.resolve(opts.paused)),
    update: vi.fn(() => Promise.resolve({ affected: 1 })),
  };
  const runItems = { update: vi.fn(() => Promise.resolve({ affected: 2 })) };
  const s3 = {
    ensureBucket: vi.fn(opts.ensureBucket ?? (() => Promise.resolve())),
  };
  const nil = undefined as never;
  const svc = new UserBackupService(
    s3 as never,
    nil,
    nil,
    nil,
    nil,
    users as unknown as Repository<User>,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    runs as unknown as Repository<BackupRun>,
    runItems as unknown as Repository<BackupRunItem>,
    nil,
  );
  return { svc, runs, runItems, s3 };
}

describe('UserBackupService.startBackup — paused run', () => {
  it('resumes the paused backup instead of answering 409', async () => {
    const paused: Partial<BackupRun> = {
      id: 'run-1',
      userId: USER,
      kind: 'backup',
      state: 'paused',
      uploaded: 7,
    };
    const { svc, runs, runItems } = makeService({ paused });

    await expect(svc.startBackup('ada@example.com')).resolves.toEqual({ runId: 'run-1' });

    // the items go back to pending, failed ones included
    expect(runItems.update).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      expect.objectContaining({ state: 'pending', attempts: 0 }),
    );
    // counters are re-derived: retried failures are no longer failures, completed == uploaded
    expect(runs.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ state: 'running', failedItems: 0, completedItems: 7 }),
    );
  });

  it('only resumes backups, never a paused restore', async () => {
    const { svc, runs, s3 } = makeService({
      paused: null,
      ensureBucket: () => Promise.reject(new Error('s3-down')),
    });

    await expect(svc.startBackup('ada@example.com')).rejects.toThrow('s3-down');
    expect(runs.findOne).toHaveBeenCalledWith({
      where: { userId: USER, kind: 'backup', state: 'paused' },
      order: { startedAt: 'DESC' },
    });
    expect(runs.update).not.toHaveBeenCalled();
    expect(s3.ensureBucket).toHaveBeenCalled();
  });
});
