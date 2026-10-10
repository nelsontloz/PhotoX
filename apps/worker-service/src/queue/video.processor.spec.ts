import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { UnrecoverableError, type Job } from 'bullmq'
import { LocalStorageService } from '@photox/shared-config'
import type { FileRecord } from '@photox/shared-types'
import { VideoProcessor } from './video.processor'
import type { CoreClient, RegisterFileInput } from '../core/core-client.service'
import { FakeCoreClient, makeAsset, makeFileRecord } from '../../test/fake-core-client'
import type { AssetRefsJob } from './job-schemas'

interface PrivateVideoProcessor {
  downloadSource(record: FileRecord, destDir: string): Promise<string>
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

  it('copies the stored source bytes to the destination directory', async () => {
    const fileId = randomUUID()
    const fileBytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    const storageKey = storage.buildKey('original', userId, fileId, 'mp4')
    const staging = join(storageDir, 'staging.mp4')
    await writeFile(staging, fileBytes)
    await storage.save(storageKey, staging)
    const record = makeFileRecord({
      id: fileId,
      userId,
      storageKey,
      mimeType: 'video/mp4',
    })

    const downloadSource = (processor as unknown as PrivateVideoProcessor).downloadSource.bind(
      processor,
    )

    const destDir = join(storageDir, 'dest')
    const result = await downloadSource(record, destDir)

    expect(result.startsWith(destDir)).toBe(true)
    expect(result.endsWith('.mp4')).toBe(true)
    expect(await readFile(result)).toEqual(fileBytes)
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
      callbacks[0]!({ data: base } as unknown as Job<AssetRefsJob>),
    ).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fake.callsOf('patchMetadata')).toHaveLength(0)
  })
})
