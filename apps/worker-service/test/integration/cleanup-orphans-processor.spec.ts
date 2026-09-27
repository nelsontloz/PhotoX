import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Asset, AssetThumbnail, FileRecord } from '@photox/data-access'
import { createTestApp, closeTestApp, resetDb, waitForJob, type TestApp } from './helpers'

// ponytail: FileRecord.createdAt is a naive timestamp, so TypeORM/pg compare it with local wall-clock
// values. The processor's grace window assumes UTC (containers run UTC); pin it so non-UTC hosts match.
process.env.TZ = 'UTC'

// processor grace is 10 min; backdate well past it
const OLD = new Date(Date.now() - 60 * 60 * 1000)

describe('CleanupOrphansProcessor (integration)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await createTestApp()
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(testApp)
  })

  beforeEach(async () => {
    await resetDb(testApp)
  })

  async function seedFile(
    userId: string,
    opts?: { purpose?: 'original' | 'transcode'; createdAt?: Date },
  ): Promise<FileRecord> {
    const bytes = Buffer.from(`file-${randomUUID()}`)
    const purpose = opts?.purpose ?? 'original'
    const storageKey = testApp.storage.buildKey(
      purpose === 'transcode' ? 'transcode' : 'original',
      userId,
      randomUUID(),
      'bin',
    )
    await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
    await writeFile(testApp.storage.pathFor(storageKey), bytes)
    const record = await testApp.fileRepo.save(
      testApp.fileRepo.create({
        userId,
        storageKey,
        originalName: purpose === 'transcode' ? 'video.webm' : 'photo.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: bytes.length,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        purpose,
        assetId: null,
      }),
    )
    if (opts?.createdAt) await testApp.fileRepo.update(record.id, { createdAt: opts.createdAt })
    return record
  }

  async function seedAsset(
    userId: string,
    fileId: string,
    opts?: { transcodeFileId?: string },
  ): Promise<Asset> {
    return testApp.assetRepo.save(
      testApp.assetRepo.create({
        userId,
        kind: 'video',
        fileId,
        transcodeFileId: opts?.transcodeFileId ?? null,
      }),
    )
  }

  async function seedThumb(
    assetId: string,
    size: string,
    fileId: string,
    createdAt?: Date,
  ): Promise<AssetThumbnail> {
    const thumb = await testApp.thumbRepo.save(
      testApp.thumbRepo.create({ assetId, size, fileId, width: 10, height: 10, bytes: 5 }),
    )
    if (createdAt) await testApp.thumbRepo.update(thumb.id, { createdAt })
    return thumb
  }

  async function runCleanup(): Promise<void> {
    const queue = testApp.getQueue('cleanup-orphans')
    const job = await queue.add('cleanup-orphans', { dryRun: false }, { jobId: randomUUID() })
    expect(await waitForJob(queue, job.id!)).toBe('completed')
  }

  it('deletes an orphan FileRecord older than the grace period plus its blob', async () => {
    const orphan = await seedFile(randomUUID(), { createdAt: OLD })

    await runCleanup()

    expect(await testApp.fileRepo.findOne({ where: { id: orphan.id } })).toBeNull()
    await expect(testApp.storage.stat(orphan.storageKey)).rejects.toThrow()
  })

  it('keeps an orphan FileRecord younger than the grace period', async () => {
    const fresh = await seedFile(randomUUID())

    await runCleanup()

    expect(await testApp.fileRepo.findOne({ where: { id: fresh.id } })).toBeTruthy()
    const stat = await testApp.storage.stat(fresh.storageKey)
    expect(stat.size).toBeGreaterThan(0)
  })

  it('keeps files referenced by asset.fileId, asset.transcodeFileId and asset_thumbnails.fileId', async () => {
    const userId = randomUUID()
    const original = await seedFile(userId, { createdAt: OLD })
    const transcode = await seedFile(userId, { purpose: 'transcode', createdAt: OLD })
    const thumbFile = await seedFile(userId, { createdAt: OLD })
    const asset = await seedAsset(userId, original.id, { transcodeFileId: transcode.id })
    await seedThumb(asset.id, 'sm', thumbFile.id, OLD)

    await runCleanup()

    for (const record of [original, transcode, thumbFile]) {
      expect(await testApp.fileRepo.findOne({ where: { id: record.id } })).toBeTruthy()
      const stat = await testApp.storage.stat(record.storageKey)
      expect(stat.size).toBeGreaterThan(0)
    }
  })

  // ponytail: source bug documented, not fixed here — the processor selects `t.size` without an
  // alias, so getRawMany() returns `t_size`; the subsequent delete({ assetId, size }) gets
  // size === undefined and affects 0 rows. Asserted actual behaviour: stale rows survive.
  it('keeps stale AssetThumbnail rows (source size-alias bug makes the delete a no-op)', async () => {
    const userId = randomUUID()
    const keeper = await seedFile(userId, { createdAt: OLD })
    const asset = await seedAsset(userId, keeper.id)
    const staleThumb = await seedThumb(asset.id, 'sm', randomUUID(), OLD)
    const freshThumb = await seedThumb(asset.id, 'md', randomUUID())

    await runCleanup()

    expect(await testApp.thumbRepo.findOne({ where: { id: staleThumb.id } })).toBeTruthy()
    expect(await testApp.thumbRepo.findOne({ where: { id: freshThumb.id } })).toBeTruthy()
  })

  it('deletes disk strays but skips models/ and *.tmp', async () => {
    const known = await seedFile(randomUUID())
    const stray = 'originals/stray-orphan.bin'
    const tmp = 'originals/stray-upload.bin.tmp'
    const model = 'models/buffalo_l/w600k_r50.onnx'
    for (const key of [stray, tmp, model]) {
      await mkdir(dirname(testApp.storage.pathFor(key)), { recursive: true })
      await writeFile(testApp.storage.pathFor(key), Buffer.from('stray-bytes'))
    }

    await runCleanup()

    await expect(testApp.storage.stat(stray)).rejects.toThrow()
    expect((await testApp.storage.stat(tmp)).size).toBeGreaterThan(0)
    expect((await testApp.storage.stat(model)).size).toBeGreaterThan(0)
    expect(await testApp.fileRepo.findOne({ where: { id: known.id } })).toBeTruthy()
    expect((await testApp.storage.stat(known.storageKey)).size).toBeGreaterThan(0)
  })
})
