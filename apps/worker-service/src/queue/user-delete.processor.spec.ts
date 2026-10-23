import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnrecoverableError, type Job } from 'bullmq'
import { UserDeleteProcessor } from './user-delete.processor'
import type { UserDeleteJob } from './job-schemas'
import type { CoreClient } from '../core/core-client.service'
import { FakeCoreClient } from '../../test/fake-core-client'
import { signJob, useTestAuthEnv } from '../../test/sign-job'

const USER_ID = '33333333-3333-4333-8333-333333333333'
const EMAIL = 'doomed@example.com'
const PREFIX = `backups/${EMAIL}__${USER_ID}/`

describe('UserDeleteProcessor', () => {
  let fake: FakeCoreClient
  let drainUserJobs: ReturnType<typeof vi.fn>
  let callbacks: ((job: Job<UserDeleteJob>) => Promise<void>)[]

  function setup() {
    callbacks = []
    drainUserJobs = vi.fn().mockResolvedValue(2)
    const bullMq = {
      createWorker: vi.fn((_name: string, cb: (job: Job<UserDeleteJob>) => Promise<void>) => {
        callbacks.push(cb)
        return {}
      }),
      drainUserJobs,
    }
    const processor = new UserDeleteProcessor(
      bullMq as never,
      fake as unknown as CoreClient,
    )
    processor.onModuleInit()
    return callbacks[0]!
  }

  const job = (data: unknown) => ({ data }) as Job<UserDeleteJob>

  beforeEach(() => {
    useTestAuthEnv()
    fake = new FakeCoreClient()
  })

  it('drains the user media jobs, then asks core to purge the account', async () => {
    const process = setup()
    await process(job(signJob({ userId: USER_ID, email: EMAIL, backupPrefix: PREFIX })))

    expect(drainUserJobs).toHaveBeenCalledWith(USER_ID)
    const [call] = fake.callsOf('purgeUser')
    expect(call?.args).toEqual([USER_ID, PREFIX])
    expect(call?.binding?.sig).toBeTruthy()
  })

  it('rejects an unsigned payload without draining or calling core', async () => {
    const process = setup()
    await expect(
      process(job({ userId: USER_ID, email: EMAIL, backupPrefix: PREFIX })),
    ).rejects.toBeInstanceOf(UnrecoverableError)
    expect(drainUserJobs).not.toHaveBeenCalled()
    expect(fake.calls).toHaveLength(0)
  })
})
