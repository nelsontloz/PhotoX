import { describe, expect, it, vi } from 'vitest'
import { UnrecoverableError, type Job } from 'bullmq'
import { randomUUID } from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { branchFor, MetadataProcessor } from './metadata.processor'
import type { MetadataJob } from './job-schemas'
import type { CoreClient } from '../core/core-client.service'
import { FakeCoreClient, makeAsset, makeFileRecord } from '../../test/fake-core-client'

describe('branchFor', () => {
  it('branches on the probed mime type', () => {
    expect(branchFor('image/jpeg')).toBe('photo')
    expect(branchFor('image/heic')).toBe('photo')
    expect(branchFor('video/mp4')).toBe('video')
    expect(branchFor('video/webm')).toBe('video')
  })

  it('returns null for unknown or missing mime types', () => {
    expect(branchFor('application/octet-stream')).toBeNull()
    expect(branchFor(null)).toBeNull()
    expect(branchFor('')).toBeNull()
  })
})

describe('MetadataProcessor job guards', () => {
  const base = {
    assetId: randomUUID(),
    fileId: randomUUID(),
    userId: randomUUID(),
    kind: 'photo' as const,
  }
  const fakeJob = (data: unknown) => ({ data }) as unknown as Job<MetadataJob>

  function setup(
    opts: {
      storage?: { pathFor(key: string): string }
      metadataExtractor?: { extract(buffer: Buffer): Record<string, unknown> }
    } = {},
  ) {
    const fake = new FakeCoreClient()
    const callbacks: ((job: Job<MetadataJob>) => Promise<void>)[] = []
    const bullMq = {
      createWorker: vi.fn((_name: string, cb: (job: Job<MetadataJob>) => Promise<void>) => {
        callbacks.push(cb)
        return {}
      }),
    }
    const processor = new MetadataProcessor(
      bullMq as never,
      fake as unknown as CoreClient,
      (opts.storage ?? {}) as never,
      (opts.metadataExtractor ?? {}) as never,
      {} as never,
    )
    processor.start()
    return { run: callbacks[0]!, fake }
  }

  it('rejects an invalid payload before any core call', async () => {
    const { run, fake } = setup()

    await expect(run(fakeJob({ ...base, kind: 'audio' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    )

    expect(fake.calls).toHaveLength(0)
  })

  it('rejects a job whose asset belongs to another user without patching', async () => {
    const otherUser = randomUUID()
    const { run, fake } = setup()
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: base.userId }))
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: otherUser, fileId: base.fileId }),
    )

    await expect(run(fakeJob(base))).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fake.callsOf('patchMetadata')).toHaveLength(0)
  })

  it('rounds a fractional EXIF iso before patching', async () => {
    const sourcePath = join(tmpdir(), `metadata-spec-${randomUUID()}`)
    await writeFile(sourcePath, 'exif-source')
    try {
      const { run, fake } = setup({
        storage: { pathFor: () => sourcePath },
        metadataExtractor: { extract: () => ({ iso: 100.5 }) },
      })
      fake.files.set(
        base.fileId,
        makeFileRecord({ id: base.fileId, userId: base.userId, mimeType: 'image/jpeg' }),
      )
      fake.assets.set(
        base.assetId,
        makeAsset({ id: base.assetId, userId: base.userId, fileId: base.fileId }),
      )

      await run(fakeJob(base))

      const patch = fake.callsOf('patchMetadata').at(-1)!.args[1] as { iso: number; status: string }
      expect(patch.iso).toBe(101)
      expect(patch.status).toBe('ready')
      expect(fake.assets.get(base.assetId)!.metadataStatus).toBe('ready')
    } finally {
      await unlink(sourcePath).catch(() => undefined)
    }
  })
})
