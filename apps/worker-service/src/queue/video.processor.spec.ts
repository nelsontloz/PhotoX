import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { UnrecoverableError, type Job } from 'bullmq'
import { LocalStorageService } from '@photox/shared-config'
import { registerDerivative, videoProcessor } from './video.processor'
import type { CoreClient, RegisterFileInput } from '../core/core-client.service'
import { FakeCoreClient, makeAsset, makeFileRecord } from '../../test/fake-core-client'
import { signJob, useTestAuthEnv } from '../../test/sign-job'
import type { AssetRefsJob } from './job-schemas'

describe('VideoProcessor disk paths', () => {
  const userId = randomUUID()
  let storageDir: string
  let prevStorageDir: string | undefined
  let storage: LocalStorageService
  let fake: FakeCoreClient

  beforeEach(() => {
    useTestAuthEnv()
    storageDir = mkdtempSync(join(tmpdir(), 'photox-vp-test-'))
    prevStorageDir = process.env.STORAGE_DIR
    process.env.STORAGE_DIR = storageDir
    storage = new LocalStorageService()
    fake = new FakeCoreClient(storage)
  })

  afterEach(() => {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
    rmSync(storageDir, { recursive: true, force: true })
  })

  const deps = () => ({ core: fake as unknown as CoreClient, storage })

  it('registers a derivative as a transcode FileRecord with bytes on disk', async () => {
    const outPath = join(storageDir, 'output.webm')
    const webmBytes = Buffer.from([9, 8, 7, 6])
    await writeFile(outPath, webmBytes)

    const assetId = randomUUID()
    const derivativeId = await registerDerivative(deps(), assetId, userId, outPath)

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

    const assetId = randomUUID()
    const firstId = await registerDerivative(deps(), assetId, userId, outPath)
    // a retry re-runs ffmpeg and produces the same bytes at the same path (save moves the file)
    await writeFile(outPath, Buffer.from([1, 2, 3]))
    const secondId = await registerDerivative(deps(), assetId, userId, outPath)

    expect(secondId).toBe(firstId)
    const dto = fake.callsOf('registerFile')[1]!.args[0] as RegisterFileInput
    expect(dto.id).not.toBe(firstId)
    expect(await storage.exists(storage.buildKey('transcode', userId, dto.id, 'webm'))).toBe(false)
    expect(await storage.exists(storage.buildKey('transcode', userId, firstId, 'webm'))).toBe(true)
  })

  it('rejects a job whose asset belongs to another user before patching', async () => {
    const run = videoProcessor(deps()).run

    const base = { assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() }
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: base.userId }))
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: randomUUID(), fileId: base.fileId }),
    )

    await expect(
      run({ data: signJob(base) } as unknown as Job<AssetRefsJob>),
    ).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fake.callsOf('patchMetadata')).toHaveLength(0)
  })
})

// ponytail: unbounded video concurrency lets 1h SVT-AV1 jobs pile up — the worker must
// pass a concurrency opt instead of bullmq's default of 1
describe('VideoProcessor concurrency', () => {
  it('requests concurrency >1 on the process-video worker', () => {
    const spec = videoProcessor({ core: {} as never, storage: {} as never })

    expect(spec.queue).toBe('process-video')
    expect(spec.workerOptions?.concurrency).toBeGreaterThan(1)
  })
})
