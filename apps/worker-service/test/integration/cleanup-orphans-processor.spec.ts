import { randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { createTestApp, closeTestApp, resetTestApp, waitForJob, type TestApp } from './helpers'

describe('CleanupOrphansProcessor (integration)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await createTestApp()
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(testApp)
  })

  beforeEach(async () => {
    await resetTestApp(testApp)
  })

  async function runCleanup(attempts = 1) {
    const queue = testApp.getQueue('cleanup-orphans')
    const job = await queue.add(
      'cleanup-orphans',
      {},
      {
        jobId: randomUUID(),
        ...(attempts > 1 ? { attempts, backoff: { type: 'fixed' as const, delay: 50 } } : {}),
      },
    )
    return { queue, job }
  }

  it('runs the admin cleanup endpoint and logs the returned counts', async () => {
    testApp.fake.orphanCleanupResult = {
      deletedFiles: 2,
      deletedThumbnails: 3,
      deletedStrays: 4,
    }
    const logSpy = vi.spyOn(Logger.prototype, 'log')

    const { queue, job } = await runCleanup()
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    expect(testApp.fake.callsOf('adminRunOrphanCleanup')).toHaveLength(1)
    const logged = logSpy.mock.calls.flat().join('\n')
    expect(logged).toContain('deleted 2 files, 3 thumbnail rows, 4 stray disk files')
    logSpy.mockRestore()
  })

  it('accepts an empty payload', async () => {
    const queue = testApp.getQueue('cleanup-orphans')
    const job = await queue.add('cleanup-orphans', {})

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('adminRunOrphanCleanup')).toHaveLength(1)
  })

  it('fails unrecoverably on an invalid payload without calling core', async () => {
    const queue = testApp.getQueue('cleanup-orphans')
    const job = await queue.add('cleanup-orphans', [])

    expect(await waitForJob(queue, job.id!)).toBe('failed')
    expect((await queue.getJob(job.id!))?.failedReason).toContain(
      'Invalid cleanup-orphans job payload',
    )
    expect(testApp.fake.callsOf('adminRunOrphanCleanup')).toHaveLength(0)
  })

  it('retries the job after transient core failures, then completes', async () => {
    testApp.fake.orphanCleanupFailures = 2

    const { queue, job } = await runCleanup(3)
    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('adminRunOrphanCleanup')).toHaveLength(3)
  })
})
