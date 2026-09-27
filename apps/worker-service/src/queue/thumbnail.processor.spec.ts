import { describe, expect, it, vi } from 'vitest'
import { UnrecoverableError, type Job } from 'bullmq'
import { randomUUID } from 'crypto'
import { ThumbnailProcessor } from './thumbnail.processor'
import type { ThumbnailJob } from './job-schemas'

describe('ThumbnailProcessor job guards', () => {
  const base = { assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() }
  const fakeJob = (data: unknown) => ({ data }) as unknown as Job<ThumbnailJob>

  function setup(record: unknown, asset: unknown) {
    const fileFindOne = vi.fn().mockResolvedValue(record)
    const assetFindOne = vi.fn().mockResolvedValue(asset)
    const assetUpdate = vi.fn().mockResolvedValue({})
    const thumbUpsert = vi.fn().mockResolvedValue({})
    const fileSave = vi.fn().mockResolvedValue({})
    const callbacks: ((job: Job<ThumbnailJob>) => Promise<void>)[] = []
    const bullMq = {
      createWorker: vi.fn((_name: string, cb: (job: Job<ThumbnailJob>) => Promise<void>) => {
        callbacks.push(cb)
        return {}
      }),
    }
    const processor = new ThumbnailProcessor(
      bullMq as never,
      { findOne: fileFindOne, save: fileSave, create: vi.fn() } as never,
      { findOne: assetFindOne, update: assetUpdate } as never,
      { upsert: thumbUpsert } as never,
      {} as never,
    )
    processor.start()
    return { run: callbacks[0]!, fileFindOne, assetFindOne, assetUpdate, thumbUpsert, fileSave }
  }

  it('rejects an invalid payload before touching the database', async () => {
    const { run, fileFindOne, assetFindOne } = setup(null, null)

    await expect(run(fakeJob({ ...base, size: 'huge' }))).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fileFindOne).not.toHaveBeenCalled()
    expect(assetFindOne).not.toHaveBeenCalled()
  })

  it('rejects a job whose file and asset belong to another user without mutating', async () => {
    const otherUser = randomUUID()
    const { run, assetUpdate, thumbUpsert, fileSave } = setup(
      { id: base.fileId, userId: otherUser, mimeType: 'image/png', storageKey: 'stray' },
      { id: base.assetId, userId: otherUser, fileId: base.fileId },
    )

    await expect(run(fakeJob({ ...base, size: 'sm' }))).rejects.toBeInstanceOf(UnrecoverableError)

    expect(assetUpdate).not.toHaveBeenCalled()
    expect(thumbUpsert).not.toHaveBeenCalled()
    expect(fileSave).not.toHaveBeenCalled()
  })
})
