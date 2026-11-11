import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import type { LocalStorageService } from '@photox/shared-config';
import { sweepUserStorage } from '@photox/shared-config';
import { userDeleteProcessor } from './user-delete.processor';
import type { UserDeleteJob } from './job-schemas';
import type { CoreClient } from '../core/core-client.service';
import { signJob, useTestAuthEnv } from '../../test/sign-job';

// the sweep walks real directories; stub it so the spec drives its result directly
vi.mock('@photox/shared-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@photox/shared-config')>()),
  sweepUserStorage: vi.fn(),
}));

const sweep = vi.mocked(sweepUserStorage);

const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'doomed@example.com';
const PREFIX = `backups/${EMAIL}__${USER_ID}/`;

type BullMqDrain = (userId: string) => Promise<number>;

describe('UserDeleteProcessor', () => {
  let drainUserJobs: Mock<BullMqDrain>;
  let purgeStep: Mock<CoreClient['purgeStep']>;
  let purgeFinish: Mock<CoreClient['purgeFinish']>;
  let updateProgress: Mock<(progress: unknown) => Promise<void>>;

  function setup() {
    drainUserJobs = vi.fn<BullMqDrain>().mockResolvedValue(2);
    purgeStep = vi.fn<CoreClient['purgeStep']>();
    purgeFinish = vi.fn<CoreClient['purgeFinish']>().mockResolvedValue({ state: 'completed' });
    return userDeleteProcessor({
      bullMq: { drainUserJobs } as never,
      core: { purgeStep, purgeFinish } as unknown as CoreClient,
      // sweepUserStorage is mocked, so this shape is never touched
      storage: { pathFor: vi.fn(), delete: vi.fn() } as unknown as LocalStorageService,
    }).run;
  }

  function makeJob(attemptsMade = 0, attempts = 3): Job<UserDeleteJob> {
    updateProgress = vi.fn<(progress: unknown) => Promise<void>>().mockResolvedValue(undefined);
    return {
      data: signJob({ userId: USER_ID, email: EMAIL, backupPrefix: PREFIX }),
      updateProgress,
      attemptsMade,
      opts: { attempts },
    } as unknown as Job<UserDeleteJob>;
  }

  beforeEach(() => {
    useTestAuthEnv();
    sweep.mockReset();
    sweep.mockResolvedValue({ deleted: 0, failed: 0 });
  });

  it('loops until done, then reports the sweep counts to core', async () => {
    const process = setup();
    purgeStep
      .mockResolvedValueOnce({ done: false, phase: 'tokens', deleted: 0 })
      .mockResolvedValueOnce({ done: false, phase: 'assets', deleted: 200 })
      .mockResolvedValueOnce({ done: true, phase: 'user', deleted: 1 });
    sweep.mockResolvedValue({ deleted: 42, failed: 0 });
    const job = makeJob();

    await process(job);

    expect(purgeStep).toHaveBeenCalledTimes(3);
    expect(purgeStep.mock.calls.map((call) => call[1])).toEqual([PREFIX, PREFIX, PREFIX]);
    const firstBinding = purgeStep.mock.calls[0]?.[2];
    expect(firstBinding?.sig).toBeTruthy();
    expect(updateProgress).toHaveBeenCalledTimes(3);
    expect(updateProgress).toHaveBeenNthCalledWith(1, { phase: 'tokens', deleted: 0 });
    expect(updateProgress).toHaveBeenNthCalledWith(3, { phase: 'user', deleted: 1 });
    expect(sweep).toHaveBeenCalledWith(expect.anything(), USER_ID);
    expect(purgeFinish).toHaveBeenCalledWith(
      USER_ID,
      { backupPrefix: PREFIX, filesDeleted: 42, filesFailed: 0 },
      expect.anything(),
    );
    expect(purgeFinish.mock.calls[0]?.[2]?.sig).toBeTruthy();
  });

  it('drains the user media jobs before the first purge step', async () => {
    const process = setup();
    purgeStep.mockResolvedValue({ done: true, phase: 'rows-done', deleted: 0 });

    await process(makeJob());

    expect(drainUserJobs).toHaveBeenCalledWith(USER_ID);
    const drainAt = drainUserJobs.mock.invocationCallOrder[0] ?? 0;
    const stepAt = purgeStep.mock.invocationCallOrder[0] ?? 0;
    expect(drainAt).toBeLessThan(stepAt);
  });

  it('reports a failed run when a step rejects on the last attempt', async () => {
    const process = setup();
    purgeStep.mockRejectedValue(new Error('core exploded'));

    await expect(process(makeJob(2, 3))).rejects.toThrow('core exploded');

    expect(purgeFinish).toHaveBeenCalledWith(
      USER_ID,
      { backupPrefix: PREFIX, filesDeleted: 0, filesFailed: 0, error: 'core exploded' },
      expect.anything(),
    );
    expect(purgeFinish.mock.calls[0]?.[2]?.sig).toBeTruthy();
  });

  it('leaves the run alone when a step rejects before the last attempt', async () => {
    const process = setup();
    purgeStep.mockRejectedValue(new Error('core exploded'));

    await expect(process(makeJob(0, 3))).rejects.toThrow('core exploded');

    expect(purgeFinish).not.toHaveBeenCalled();
  });

  it('reports a partial sweep, then throws without overwriting the report', async () => {
    const process = setup();
    purgeStep.mockResolvedValue({ done: true, phase: 'rows-done', deleted: 0 });
    sweep.mockResolvedValue({ deleted: 7, failed: 2, firstError: 'originals/a: EACCES' });

    await expect(process(makeJob(2, 3))).rejects.toThrow('User-delete left 2 files');

    expect(purgeFinish).toHaveBeenCalledTimes(1);
    expect(purgeFinish).toHaveBeenCalledWith(
      USER_ID,
      {
        backupPrefix: PREFIX,
        filesDeleted: 7,
        filesFailed: 2,
        firstError: 'originals/a: EACCES',
      },
      expect.anything(),
    );
  });

  it('rejects an unsigned payload without draining, stepping or reporting', async () => {
    const process = setup();

    await expect(
      process({
        data: { userId: USER_ID, email: EMAIL, backupPrefix: PREFIX },
      } as Job<UserDeleteJob>),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(drainUserJobs).not.toHaveBeenCalled();
    expect(purgeStep).not.toHaveBeenCalled();
    expect(purgeFinish).not.toHaveBeenCalled();
  });
});
