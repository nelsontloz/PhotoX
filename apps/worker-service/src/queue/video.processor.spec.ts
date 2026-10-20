import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { UnrecoverableError, type Job } from 'bullmq'
import { LocalStorageService } from '@photox/shared-config'
import { VideoProcessor } from './video.processor'
import type { CoreClient, RegisterFileInput } from '../core/core-client.service'
import { FakeCoreClient, makeAsset, makeFileRecord } from '../../test/fake-core-client'
import { signJob, useTestAuthEnv } from '../../test/sign-job'
import type { AssetRefsJob } from './job-schemas'

interface PrivateVideoProcessor {
  registerDerivative(assetId: string, userId: string, outPath: string): Promise<string>
}

describe('VideoProcessor disk paths', () => {
  const userId = randomUUID()
  let storageDir: string
  let prevStorageDir: string | undefined
  let storage: LocalStorageService
  let fake: FakeCoreClient
  let processor: VideoProcessor

  beforeEach(() => {
    useTestAuthEnv()
    storageDir = mkdtempSync(join(tmpdir(), 'photox-vp-test-'))
    prevStorageDir = process.env.STORAGE_DIR
    process.env.STORAGE_DIR = storageDir
    storage = new LocalStorageService()
    fake = new FakeCoreClient(storage)
    processor = new VideoProcessor({} as never, fake as unknown as CoreClient, storage)
  })

  afterEach(() => {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
    rmSync(storageDir, { recursive: true, force: true })
  })

  it('registers a derivative as a transcode FileRecord with bytes on disk', async () => {
    const outPath = join(storageDir, 'output.webm')
    const webmBytes = Buffer.from([9, 8, 7, 6])
    await writeFile(outPath, webmBytes)

    const registerDerivative = (
      processor as unknown as PrivateVideoProcessor
    ).registerDerivative.bind(processor)

    const assetId = randomUUID()
    const derivativeId = await registerDerivative(assetId, userId, outPath)

    const row = fake.files.get(derivativeId)!
    expect(row.purpose).toBe('transcode')
    expect(row.assetId).toBe(assetId)
    expect(row.mimeType).toBe('video/webm')
    expect(row.sizeBytes).toBe(webmBytes.length)
    expect(await readFile(storage.pathFor(row.storageKey))).toEqual(webmBytes)

    const dto = fake.callsOf('registerFile')[0]!.args[0] as RegisterFileInput
    expect(dto).toMatchObject({
      id: derivativeId,
      kind: 'transcode',
      ext: 'webm',
      assetId,
      originalName: 'video.webm',
      sizeBytes: webmBytes.length,
    })
  })

  it('reuses the deduped derivative id and drops the duplicate copy', async () => {
    fake.dedupeRegistrations = true
    const outPath = join(storageDir, 'output.webm')
    await writeFile(outPath, Buffer.from([1, 2, 3]))

    const registerDerivative = (
      processor as unknown as PrivateVideoProcessor
    ).registerDerivative.bind(processor)

    const assetId = randomUUID()
    const firstId = await registerDerivative(assetId, userId, outPath)
    // a retry re-runs ffmpeg and produces the same bytes at the same path (save moves the file)
    await writeFile(outPath, Buffer.from([1, 2, 3]))
    const secondId = await registerDerivative(assetId, userId, outPath)

    expect(secondId).toBe(firstId)
    const dto = fake.callsOf('registerFile')[1]!.args[0] as RegisterFileInput
    expect(dto.id).not.toBe(firstId)
    expect(await storage.exists(storage.buildKey('transcode', userId, dto.id, 'webm'))).toBe(false)
    expect(await storage.exists(storage.buildKey('transcode', userId, firstId, 'webm'))).toBe(true)
  })

  it('rejects a job whose asset belongs to another user before patching', async () => {
    const callbacks: ((job: Job<AssetRefsJob>) => Promise<void>)[] = []
    const bullMq = {
      createWorker: vi.fn((_name: string, cb: (job: Job<AssetRefsJob>) => Promise<void>) => {
        callbacks.push(cb)
        return {}
      }),
    }
    const guarded = new VideoProcessor(bullMq as never, fake as unknown as CoreClient, storage)
    guarded.onModuleInit()

    const base = { assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() }
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: base.userId }))
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: randomUUID(), fileId: base.fileId }),
    )

    await expect(
      callbacks[0]!({ data: signJob(base) } as unknown as Job<AssetRefsJob>),
    ).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fake.callsOf('patchMetadata')).toHaveLength(0)
  })
})

// ponytail: unbounded video concurrency lets 1h SVT-AV1 jobs pile up — the worker must
// pass a concurrency opt instead of bullmq's default of 1
describe('VideoProcessor concurrency', () => {
  it('requests concurrency >1 on the process-video worker', () => {
    const createWorker = vi.fn(
      (name: string, cb: (job: unknown) => Promise<void>, opts?: { concurrency?: number }) => {
        void name
        void cb
        void opts
        return {}
      },
    )
    const processor = new VideoProcessor({ createWorker } as never, {} as never, {} as never)
    processor.onModuleInit()

    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(createWorker.mock.calls[0]?.[0]).toBe('process-video')
    const opts = createWorker.mock.calls[0]?.[2]
    expect(opts?.concurrency).toBeGreaterThan(1)
  })
})
