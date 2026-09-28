import { randomUUID } from 'node:crypto'
import { makeFileRecord } from '../fake-core-client'
import { createTestApp, closeTestApp, resetTestApp, waitForJob, type TestApp } from './helpers'

describe('CleanupProcessor (integration)', () => {
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

  it('delegates blob + row deletion to the admin endpoint', async () => {
    const fileId = randomUUID()
    testApp.fake.files.set(fileId, makeFileRecord({ id: fileId, userId: randomUUID() }))

    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add('cleanup-asset', { fileId })

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('adminDeleteFile').map((c) => c.args[0])).toEqual([fileId])
    expect(testApp.fake.files.has(fileId)).toBe(false)
  })

  it('is a no-op for a fileId with no record (endpoint is idempotent)', async () => {
    const fileId = randomUUID()

    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add('cleanup-asset', { fileId })

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('adminDeleteFile')).toHaveLength(1)
  })

  it('fails unrecoverably on an invalid payload without calling core', async () => {
    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add('cleanup-asset', { fileId: 'not-a-uuid' })

    expect(await waitForJob(queue, job.id!)).toBe('failed')
    expect((await queue.getJob(job.id!))?.failedReason).toContain(
      'Invalid cleanup-asset job payload',
    )
    expect(testApp.fake.callsOf('adminDeleteFile')).toHaveLength(0)
  })

  it('retries the job after a transient core failure, then completes', async () => {
    testApp.fake.adminDeleteFileFailures = 1
    const fileId = randomUUID()

    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add(
      'cleanup-asset',
      { fileId },
      { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    )

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('adminDeleteFile')).toHaveLength(2)
  })
})
