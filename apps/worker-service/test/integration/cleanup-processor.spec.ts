import { randomUUID } from 'node:crypto'
import { makeFileRecord } from '../fake-core-client'
import {
  createTestApp,
  closeTestApp,
  resetTestApp,
  signJob,
  waitForJob,
  type TestApp,
} from './helpers'

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

  it('delegates blob + row deletion to the owned endpoint', async () => {
    const userId = randomUUID()
    const fileId = randomUUID()
    const assetId = randomUUID()
    testApp.fake.files.set(fileId, makeFileRecord({ id: fileId, userId }))

    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add('cleanup-asset', signJob({ fileId, userId, assetId }))

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('deleteOwnedFile').map((c) => c.args)).toEqual([[userId, fileId]])
    expect(testApp.fake.files.has(fileId)).toBe(false)
  })

  it('fails unrecoverably for an unknown file without retrying', async () => {
    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add(
      'cleanup-asset',
      signJob({
        fileId: randomUUID(),
        userId: randomUUID(),
        assetId: randomUUID(),
      }),
    )

    expect(await waitForJob(queue, job.id!)).toBe('failed')
    expect(testApp.fake.callsOf('deleteOwnedFile')).toHaveLength(1)
  })

  it('fails unrecoverably on an invalid payload without calling core', async () => {
    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add('cleanup-asset', { fileId: 'not-a-uuid' })

    expect(await waitForJob(queue, job.id!)).toBe('failed')
    expect((await queue.getJob(job.id!))?.failedReason).toContain(
      'Invalid cleanup-asset job payload',
    )
    expect(testApp.fake.callsOf('deleteOwnedFile')).toHaveLength(0)
  })

  it('retries the job after a transient core failure, then completes', async () => {
    testApp.fake.deleteOwnedFileFailures = 1
    const userId = randomUUID()
    const fileId = randomUUID()
    testApp.fake.files.set(fileId, makeFileRecord({ id: fileId, userId }))

    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add(
      'cleanup-asset',
      signJob({ fileId, userId, assetId: randomUUID() }),
      { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    )

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('deleteOwnedFile')).toHaveLength(2)
  })
})
