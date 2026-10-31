import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import { userDeleteProcessor } from './user-delete.processor';
import type { UserDeleteJob } from './job-schemas';
import type { CoreClient } from '../core/core-client.service';
import { FakeCoreClient } from '../../test/fake-core-client';
import { signJob, useTestAuthEnv } from '../../test/sign-job';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'doomed@example.com';
const PREFIX = `backups/${EMAIL}__${USER_ID}/`;

describe('UserDeleteProcessor', () => {
  let fake: FakeCoreClient;
  let drainUserJobs: ReturnType<typeof vi.fn>;

  function setup() {
    drainUserJobs = vi.fn().mockResolvedValue(2);
    const spec = userDeleteProcessor({
      bullMq: { drainUserJobs } as never,
      core: fake as unknown as CoreClient,
    });
    return spec.run;
  }

  const job = (data: unknown) => ({ data }) as Job<UserDeleteJob>;

  beforeEach(() => {
    useTestAuthEnv();
    fake = new FakeCoreClient();
  });

  it('drains the user media jobs, then asks core to purge the account', async () => {
    const process = setup();
    await process(job(signJob({ userId: USER_ID, email: EMAIL, backupPrefix: PREFIX })));

    expect(drainUserJobs).toHaveBeenCalledWith(USER_ID);
    const [call] = fake.callsOf('purgeUser');
    expect(call?.args).toEqual([USER_ID, PREFIX]);
    expect(call?.binding?.sig).toBeTruthy();
  });

  it('rejects an unsigned payload without draining or calling core', async () => {
    const process = setup();
    await expect(
      process(job({ userId: USER_ID, email: EMAIL, backupPrefix: PREFIX })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(drainUserJobs).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });
});
