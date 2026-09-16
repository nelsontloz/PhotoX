import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LocalStorageService } from '@photox/data-access'
import { VideoProcessor } from './video.processor'
import { BullMqService } from './bullmq.service'

describe('VideoProcessor disk paths', () => {
  const fileId = randomUUID()
  const userId = randomUUID()
  let storageDir: string
  let prevStorageDir: string | undefined
  let storage: LocalStorageService
  let records: Record<string, Record<string, unknown>>
  let fileRepo: {
    findOne: ReturnType<typeof vi.fn>
    save: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  let processor: VideoProcessor

  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'photox-vp-test-'))
    prevStorageDir = process.env.STORAGE_DIR
    process.env.STORAGE_DIR = storageDir
    storage = new LocalStorageService()
    records = {}
    fileRepo = {
      findOne: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const r = records[where.id]
        return r ? { ...r } : null
      }),
      create: vi.fn().mockImplementation((e: unknown) => ({ ...(e as object) })),
      save: vi.fn().mockImplementation((e: Record<string, unknown>) => {
        const id = (e.id as string) ?? randomUUID()
        const row = { ...e, id }
        records[id] = row
        return row
      }),
    }
    const assetRepo = { update: vi.fn().mockResolvedValue({}) }
    processor = new VideoProcessor(
      {} as BullMqService,
      fileRepo as never,
      assetRepo as never,
      storage,
    )
  })

  afterEach(() => {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
    rmSync(storageDir, { recursive: true, force: true })
  })

  it('copies the stored source bytes to the destination directory', async () => {
    const fileBytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    const storageKey = `${userId}/${fileId}.mp4`
    const staging = join(storageDir, 'staging.mp4')
    await writeFile(staging, fileBytes)
    await storage.save(storageKey, staging)
    records[fileId] = { id: fileId, userId, mimeType: 'video/mp4', storageKey }

    const destDir = join(storageDir, 'dest')
    const downloadSource = (
      processor as unknown as {
        downloadSource: (id: string, uid: string, dir: string) => Promise<string>
      }
    ).downloadSource.bind(processor)

    const result = await downloadSource(fileId, userId, destDir)

    expect(result.startsWith(destDir)).toBe(true)
    expect(result.endsWith('.mp4')).toBe(true)
    expect(await readFile(result)).toEqual(fileBytes)
  })

  it('registers a derivative as a transcode FileRecord with bytes on disk', async () => {
    const outPath = join(storageDir, 'output.webm')
    const webmBytes = Buffer.from([9, 8, 7, 6])
    await writeFile(outPath, webmBytes)

    const registerDerivative = (
      processor as unknown as {
        registerDerivative: (assetId: string, uid: string, out: string) => Promise<string>
      }
    ).registerDerivative.bind(processor)

    const assetId = randomUUID()
    const derivativeId = await registerDerivative(assetId, userId, outPath)

    const row = records[derivativeId] as unknown as {
      purpose: string
      assetId: string
      mimeType: string
      storageKey: string
      sizeBytes: number
    }
    expect(row.purpose).toBe('transcode')
    expect(row.assetId).toBe(assetId)
    expect(row.mimeType).toBe('video/webm')
    expect(await readFile(storage.pathFor(row.storageKey))).toEqual(webmBytes)
    expect(row.sizeBytes).toBe(webmBytes.length)
  })
})
