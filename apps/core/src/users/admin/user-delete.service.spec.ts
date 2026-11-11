import { ConflictException } from '@nestjs/common';
import { UserDeleteService } from './user-delete.service';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'doomed@example.com';

interface RunRow {
  userId: string;
  jobId: string;
  state: string;
  backupPrefix: string;
  phase: string | null;
  deletedRows: number;
  deletedFiles: number;
  failedFiles: number;
  error: string | null;
  sessionsLocked: boolean;
}

interface DeleteCall {
  entity: { name: string };
  criteria: unknown;
}

interface UpdateCall {
  entity: { name: string };
  id: string;
  patch: Record<string, unknown>;
}

function makeService(opts?: {
  user?: { id: string; email: string; role: 'user' | 'admin' } | null;
  run?: Partial<RunRow> | null;
  assetBatches?: string[][];
  affected?: Record<string, number>;
  boundedDeletes?: { files?: number; faces?: number };
  adminCount?: number;
  albumIds?: string[];
}) {
  let run: RunRow | null =
    opts?.run === null
      ? null
      : {
          userId: USER_ID,
          jobId: `user-delete-${USER_ID}`,
          state: 'queued',
          backupPrefix: 'backups/old/',
          phase: null,
          deletedRows: 0,
          deletedFiles: 0,
          failedFiles: 0,
          error: null,
          sessionsLocked: false,
          ...opts?.run,
        };

  const affectedOf = (name: string) => opts?.affected?.[name] ?? 1;
  const deletes: DeleteCall[] = [];
  const updates: UpdateCall[] = [];
  const queries: string[] = [];
  const user =
    opts?.user === null ? null : (opts?.user ?? { id: USER_ID, email: EMAIL, role: 'user' });

  const manager = {
    delete: vi.fn((entity: { name: string }, criteria: unknown) => {
      deletes.push({ entity, criteria });
      return Promise.resolve({ affected: affectedOf(entity.name) });
    }),
    update: vi.fn((entity: { name: string }, id: string, patch: Record<string, unknown>) => {
      updates.push({ entity, id, patch });
      return Promise.resolve({ affected: 1 });
    }),
    query: vi.fn((sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM albums')) {
        return Promise.resolve((opts?.albumIds ?? []).map((id) => ({ id })));
      }
      if (sql.includes('SELECT id FROM files')) {
        return Promise.resolve(
          Array.from({ length: opts?.boundedDeletes?.files ?? 0 }, () => ({ id: 'f' })),
        );
      }
      if (sql.includes('SELECT id FROM faces')) {
        return Promise.resolve(
          Array.from({ length: opts?.boundedDeletes?.faces ?? 0 }, () => ({ id: 'f' })),
        );
      }
      return Promise.resolve([]);
    }),
    findOne: vi.fn(() => Promise.resolve(user)),
    count: vi.fn(() => Promise.resolve(opts?.adminCount ?? 2)),
  };

  let assetCall = 0;
  const dataSource = {
    query: vi.fn((sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (sql.includes('FROM assets')) {
        const batch = opts?.assetBatches?.[assetCall++] ?? [];
        return Promise.resolve(batch.map((id) => ({ id })));
      }
      void params;
      return Promise.resolve([]);
    }),
    transaction: vi.fn((fn: (m: unknown) => Promise<unknown>) => fn(manager)),
  };

  const runs = {
    findOne: vi.fn(() => Promise.resolve(run)),
    upsert: vi.fn((row: RunRow) => {
      run = { ...row };
      return Promise.resolve();
    }),
    update: vi.fn((userId: string, patch: Partial<RunRow>) => {
      void userId;
      run = { ...run!, ...patch };
      return Promise.resolve();
    }),
  };
  const users = { findOne: vi.fn(() => Promise.resolve(user)) };
  const bullMq = { getQueue: vi.fn() };

  const service = new UserDeleteService(
    dataSource as never,
    bullMq as never,
    users as never,
    runs as never,
  );
  return {
    service,
    dataSource,
    manager,
    runs,
    users,
    bullMq,
    deletes,
    updates,
    queries,
    currentRun: () => run,
  };
}

describe('UserDeleteService.step', () => {
  it('kills sessions on the first step, before any row disappears', async () => {
    const { service, manager, dataSource, deletes, updates } = makeService();

    await expect(service.step(USER_ID, 'backups/old/')).resolves.toEqual({
      done: false,
      phase: 'tokens',
      deleted: 0,
    });

    expect(deletes.map((call) => call.entity.name)).toEqual(['RefreshToken']);
    const floor = updates.find((call) => call.entity.name === 'User');
    expect(floor?.patch.tokensValidAfter).toBeInstanceOf(Date);
    // the lock flag is written in the same transaction, so a crash cannot leave sessions alive
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), USER_ID, {
      sessionsLocked: true,
    });
    // and the durable row records the phase (raw UPDATE, so assert on its parameters)
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE user_deletes'), [
      USER_ID,
      'tokens',
      0,
    ]);
  });

  it('deletes one bounded asset batch and its un-cascaded links', async () => {
    const { service, dataSource, queries } = makeService({
      run: { sessionsLocked: true },
      assetBatches: [['a-1', 'a-2']],
    });

    await expect(service.step(USER_ID, 'backups/old/')).resolves.toEqual({
      done: false,
      phase: 'assets',
      deleted: 2,
    });

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(queries.some((sql) => sql.includes('SELECT id FROM assets'))).toBe(true);
    expect(queries.some((sql) => sql.includes('DELETE FROM album_assets'))).toBe(true);
    expect(queries.some((sql) => sql.includes('DELETE FROM faces'))).toBe(true);
    expect(queries.some((sql) => sql.includes('DELETE FROM assets'))).toBe(true);
  });

  it('walks the row phases in order and reports the first one that removed rows', async () => {
    const { service, deletes, queries } = makeService({
      run: { sessionsLocked: true },
      boundedDeletes: { files: 0, faces: 0 },
      affected: { Person: 0, Album: 0, Share: 0, UploadSession: 4 },
    });

    await expect(service.step(USER_ID, 'backups/old/')).resolves.toMatchObject({
      done: false,
      phase: 'sessions',
      deleted: 4,
    });

    // files and faces are bounded selects first; the rest go straight to the repository
    const filesAt = queries.findIndex((sql) => sql.includes('SELECT id FROM files'));
    const facesAt = queries.findIndex((sql) => sql.includes('SELECT id FROM faces'));
    expect(filesAt).toBeGreaterThanOrEqual(0);
    expect(facesAt).toBeGreaterThan(filesAt);
    expect(deletes.map((call) => call.entity.name)).toEqual([
      'Person',
      'Album',
      'Share',
      'UploadSession',
    ]);
  });

  it('drops the user row last and reports done, still expecting a byte sweep', async () => {
    const { service, deletes } = makeService({
      run: { sessionsLocked: true },
      boundedDeletes: { files: 0, faces: 0 },
      affected: {
        Person: 0,
        Album: 0,
        Share: 0,
        UploadSession: 0,
        BackupMerge: 0,
        BackupRun: 0,
      },
    });

    await expect(service.step(USER_ID, 'backups/old/')).resolves.toMatchObject({
      done: true,
      phase: 'user',
    });
    expect(deletes.at(-1)?.entity.name).toBe('User');
  });

  it('re-checks the last-admin rule inside the user phase', async () => {
    const { service, manager, deletes } = makeService({
      user: { id: USER_ID, email: EMAIL, role: 'admin' },
      adminCount: 1,
      run: { sessionsLocked: true },
      boundedDeletes: { files: 0, faces: 0 },
      affected: {
        Person: 0,
        Album: 0,
        Share: 0,
        UploadSession: 0,
        BackupMerge: 0,
        BackupRun: 0,
      },
    });

    await expect(service.step(USER_ID, 'backups/old/')).rejects.toBeInstanceOf(ConflictException);
    expect(manager.count).toHaveBeenCalled();
    expect(deletes.some((call) => call.entity.name === 'User')).toBe(false);
  });

  it('is idempotent: a finished run answers done without touching the DB', async () => {
    const { service, manager, dataSource } = makeService({ run: { state: 'completed' } });

    await expect(service.step(USER_ID, 'backups/old/')).resolves.toEqual({
      done: true,
      phase: 'rows-done',
      deleted: 0,
    });
    expect(manager.delete).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('answers done for a retry whose user row is already gone', async () => {
    const { service, manager } = makeService({ user: null, run: { sessionsLocked: true } });

    await expect(service.step(USER_ID, 'backups/old/')).resolves.toEqual({
      done: true,
      phase: 'rows-done',
      deleted: 0,
    });
    expect(manager.delete).not.toHaveBeenCalled();
  });
});

describe('UserDeleteService.finish', () => {
  it('completes when every byte was removed', async () => {
    const { service, currentRun } = makeService({ run: { state: 'active' } });
    await service.finish(USER_ID, { backupPrefix: 'p/', filesDeleted: 12, filesFailed: 0 });
    expect(currentRun()).toMatchObject({ state: 'completed', deletedFiles: 12, failedFiles: 0 });
  });

  it('reports partial (not completed) when files were left behind', async () => {
    const { service, currentRun } = makeService({ run: { state: 'active' } });
    await service.finish(USER_ID, {
      backupPrefix: 'p/',
      filesDeleted: 11,
      filesFailed: 1,
      firstError: 'originals/x.jpg: EACCES',
    });
    expect(currentRun()).toMatchObject({
      state: 'partial',
      failedFiles: 1,
      error: 'originals/x.jpg: EACCES',
    });
  });

  it('fails the run when the rows half never finished', async () => {
    const { service, currentRun } = makeService({ run: { state: 'active' } });
    await service.finish(USER_ID, {
      backupPrefix: 'p/',
      filesDeleted: 0,
      filesFailed: 0,
      error: 'database is gone',
    });
    expect(currentRun()).toMatchObject({ state: 'failed', error: 'database is gone' });
  });
});

describe('UserDeleteService.clearFinishedJob', () => {
  it('removes a retained completed job so the next enqueue is not swallowed', async () => {
    const { service, bullMq } = makeService();
    const job = {
      getState: vi.fn().mockResolvedValue('completed'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    bullMq.getQueue.mockReturnValue({ getJob: vi.fn().mockResolvedValue(job) });
    await expect(service.clearFinishedJob(USER_ID)).resolves.toBe(true);
    expect(job.remove).toHaveBeenCalled();
  });

  it('leaves an in-flight job alone so a double-click stays idempotent', async () => {
    const { service, bullMq } = makeService();
    const job = { getState: vi.fn().mockResolvedValue('active'), remove: vi.fn() };
    bullMq.getQueue.mockReturnValue({ getJob: vi.fn().mockResolvedValue(job) });
    await expect(service.clearFinishedJob(USER_ID)).resolves.toBe(false);
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('returns false when no job exists and tolerates queue failures', async () => {
    const { service, bullMq } = makeService();
    bullMq.getQueue.mockReturnValue({ getJob: vi.fn().mockResolvedValue(null) });
    await expect(service.clearFinishedJob(USER_ID)).resolves.toBe(false);
    bullMq.getQueue.mockReturnValue({
      getJob: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    await expect(service.clearFinishedJob(USER_ID)).resolves.toBe(false);
  });
});
