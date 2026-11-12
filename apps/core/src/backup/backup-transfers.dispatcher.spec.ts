import { describe, expect, it, vi } from 'vitest';
import type { DataSource, QueryRunner } from 'typeorm';
import { BackupTransfersDispatcher } from './backup-transfers.dispatcher';
import type { UserBackupService } from './user-backup.service';

type FakeRunner = Record<string, unknown>;

function makeDispatcher(runner: FakeRunner) {
  const dispatchPendingTransfers = vi.fn(() => Promise.resolve(0));
  const backups = {
    reconcileTransfers: vi.fn(() => Promise.resolve()),
    dispatchPendingTransfers,
  } as unknown as UserBackupService;
  const createQueryRunner = vi.fn(() => runner as unknown as QueryRunner);
  const dataSource = { createQueryRunner } as unknown as DataSource;
  return {
    dispatcher: new BackupTransfersDispatcher(backups, dataSource),
    dispatchPendingTransfers,
    createQueryRunner,
  };
}

describe('BackupTransfersDispatcher', () => {
  it('survives a connect failure and clears the lane so the next tick dispatches again', async () => {
    const { dispatcher, createQueryRunner } = makeDispatcher({
      connect: vi.fn(() => Promise.reject(new Error('connection refused'))),
      release: vi.fn(() => Promise.resolve()),
    });

    await expect(dispatcher.tick()).resolves.toBeUndefined();
    // two kinds in the first tick; if `ticking` leaked, the second tick would add none
    expect(createQueryRunner).toHaveBeenCalledTimes(2);
    await expect(dispatcher.tick()).resolves.toBeUndefined();
    expect(createQueryRunner).toHaveBeenCalledTimes(4);
  });

  it('clears the lane when releasing the runner throws', async () => {
    const query = vi.fn(() => Promise.resolve([{ locked: true }]));
    const { dispatcher, createQueryRunner } = makeDispatcher({
      connect: vi.fn(() => Promise.resolve()),
      query,
      release: vi.fn(() => Promise.reject(new Error('socket closed'))),
    });

    await expect(dispatcher.tick()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(4); // lock + unlock per kind
    await expect(dispatcher.tick()).resolves.toBeUndefined();
    expect(createQueryRunner).toHaveBeenCalledTimes(4);
  });

  it('does not let one failing kind stop the other', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('pg down'))
      .mockResolvedValue([{ locked: true }]);
    const { dispatcher, dispatchPendingTransfers, createQueryRunner } = makeDispatcher({
      connect: vi.fn(() => Promise.resolve()),
      query,
      release: vi.fn(() => Promise.resolve()),
    });

    await expect(dispatcher.tick()).resolves.toBeUndefined();
    expect(createQueryRunner).toHaveBeenCalledTimes(2);
    expect(dispatchPendingTransfers).toHaveBeenCalledTimes(1);
  });
});
