import { DataSource } from 'typeorm';
import { StuckAssetsSweeper } from './stuck-assets.sweeper';
import type { UserFilesService } from '../files/user/user-files.service';

function harness(options: { locked?: boolean; rows?: unknown[] }) {
  const queries: string[] = [];
  const runner = {
    connect: () => Promise.resolve(),
    release: () => Promise.resolve(),
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve(sql.includes('pg_try_advisory_lock') ? [{ locked: options.locked ?? true }] : []);
    },
  };
  const dataSource = {
    createQueryRunner: () => runner,
    query: () => Promise.resolve(options.rows ?? []),
  } as unknown as DataSource;
  const enqueueAssetJobs = vi.fn((): Promise<void> => Promise.resolve());
  const userFiles = { enqueueAssetJobs } as unknown as UserFilesService;
  return { sweeper: new StuckAssetsSweeper(userFiles, dataSource), enqueueAssetJobs, queries };
}

describe('StuckAssetsSweeper', () => {
  it('re-enqueues a pending asset older than the age floor', async () => {
    const { sweeper, enqueueAssetJobs } = harness({
      rows: [{ id: 'asset-1', fileId: 'file-1', userId: 'user-1', kind: 'photo' }],
    });

    await expect(sweeper.sweep()).resolves.toEqual({ requeued: 1 });
    expect(enqueueAssetJobs).toHaveBeenCalledWith('user-1', { id: 'file-1' }, 'photo', 'asset-1');
  });

  it('does nothing when another instance holds the advisory lock', async () => {
    const { sweeper, enqueueAssetJobs } = harness({ locked: false, rows: [{ id: 'asset-1' }] });

    await expect(sweeper.sweep()).resolves.toEqual({ requeued: 0, skipped: true });
    expect(enqueueAssetJobs).not.toHaveBeenCalled();
  });

  it('keeps sweeping the batch when one asset fails to enqueue', async () => {
    const { sweeper, enqueueAssetJobs } = harness({
      rows: [
        { id: 'asset-1', fileId: 'file-1', userId: 'user-1', kind: 'photo' },
        { id: 'asset-2', fileId: 'file-2', userId: 'user-1', kind: 'video' },
      ],
    });
    enqueueAssetJobs.mockRejectedValueOnce(new Error('redis down'));

    await expect(sweeper.sweep()).resolves.toEqual({ requeued: 1 });
    expect(enqueueAssetJobs).toHaveBeenCalledTimes(2);
  });

  it('always releases the advisory lock, even when the select throws', async () => {
    const queries: string[] = [];
    const failed = new StuckAssetsSweeper(
      { enqueueAssetJobs: () => Promise.resolve() } as unknown as UserFilesService,
      {
        createQueryRunner: () => ({
          connect: () => Promise.resolve(),
          release: () => Promise.resolve(),
          query: (sql: string) => {
            queries.push(sql);
            return sql.includes('pg_try_advisory_lock')
              ? Promise.resolve([{ locked: true }])
              : Promise.resolve([]);
          },
        }),
        query: () => Promise.reject(new Error('select failed')),
      } as unknown as DataSource,
    );

    await expect(failed.sweep()).rejects.toThrow('select failed');
    expect(queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
  });
});
