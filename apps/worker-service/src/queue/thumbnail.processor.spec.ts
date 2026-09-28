import { describe, expect, it, vi } from 'vitest'
import { UnrecoverableError, type Job } from 'bullmq'
import { randomUUID } from 'crypto'
import { ThumbnailProcessor } from './thumbnail.processor'
import type { ThumbnailJob } from './job-schemas'
import type { CoreClient } from '../core/core-client.service'
import { FakeCoreClient, makeAsset, makeFileRecord } from '../../test/fake-core-client'

describe('ThumbnailProcessor job guards', () => {
  const base = { assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() }
  const fakeJob = (data: unknown) => ({ data }) as unknown as Job<ThumbnailJob>

  function setup() {
    const fake = new FakeCoreClient()
    const callbacks: ((job: Job<ThumbnailJob>) => Promise<void>)[] = []
    const bullMq = {
      createWorker: vi.fn((_name: string, cb: (job: Job<ThumbnailJob>) => Promise<void>) => {
        callbacks.push(cb)
        return {}
      }),
    }
    const processor = new ThumbnailProcessor(
      bullMq as never,
      fake as unknown as CoreClient,
      {} as never,
    )
    processor.start()
    return { run: callbacks[0]!, fake }
  }

  it('rejects an invalid payload before any core call', async () => {
    const { run, fake } = setup()

    await expect(run(fakeJob({ ...base, size: 'huge' }))).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fake.calls).toHaveLength(0)
  })

  it('rejects a job whose file and asset belong to another user without mutating', async () => {
    const otherUser = randomUUID()
    const { run, fake } = setup()
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: otherUser }))
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: otherUser, fileId: base.fileId }),
    )

    await expect(run(fakeJob({ ...base, size: 'sm' }))).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fake.callsOf('patchMetadata')).toHaveLength(0)
    expect(fake.callsOf('registerFile')).toHaveLength(0)
    expect(fake.thumbnails).toHaveLength(0)
  })

  it('rejects a job whose asset points at a different file', async () => {
    const { run, fake } = setup()
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: base.userId }))
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: base.userId, fileId: randomUUID() }),
    )

    await expect(run(fakeJob({ ...base, size: 'sm' }))).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fake.callsOf('patchMetadata')).toHaveLength(0)
  })
})
