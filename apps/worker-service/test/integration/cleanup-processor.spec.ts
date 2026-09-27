import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createTestApp, closeTestApp, resetDb, waitForJob, type TestApp } from './helpers'

describe('CleanupProcessor (integration)', () => {
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

  async function seedFile(userId: string) {
    const bytes = Buffer.from(`file-${randomUUID()}`)
    const storageKey = testApp.storage.buildKey('original', userId, randomUUID(), 'bin')
    await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
    await writeFile(testApp.storage.pathFor(storageKey), bytes)
    return testApp.fileRepo.save(
      testApp.fileRepo.create({
        userId,
        storageKey,
        originalName: 'photo.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: bytes.length,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        purpose: 'original',
        assetId: null,
      }),
    )
  }

  it('deletes the storage file and the FileRecord row', async () => {
    const record = await seedFile(randomUUID())

    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add('cleanup-asset', { fileId: record.id })

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(await testApp.fileRepo.findOne({ where: { id: record.id } })).toBeNull()
    await expect(testApp.storage.stat(record.storageKey)).rejects.toThrow()
  })

  it('completes and still removes the row when the storage file is already gone', async () => {
    const record = await seedFile(randomUUID())
    await testApp.storage.delete(record.storageKey)

    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add('cleanup-asset', { fileId: record.id })

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(await testApp.fileRepo.findOne({ where: { id: record.id } })).toBeNull()
  })

  it('is a no-op for a fileId with no FileRecord row (disk stray untouched)', async () => {
    const fileId = randomUUID()
    const storageKey = testApp.storage.buildKey('original', randomUUID(), fileId, 'bin')
    await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
    await writeFile(testApp.storage.pathFor(storageKey), Buffer.from('stray'))

    const queue = testApp.getQueue('cleanup-asset')
    const job = await queue.add('cleanup-asset', { fileId })

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(await testApp.fileRepo.findOne({ where: { id: fileId } })).toBeNull()
    const stat = await testApp.storage.stat(storageKey)
    expect(stat.size).toBeGreaterThan(0)
  })
})
