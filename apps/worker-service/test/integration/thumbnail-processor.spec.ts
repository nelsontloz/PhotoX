import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { createTestApp, closeTestApp, resetDb, waitForJob, type TestApp } from './helpers'

describe('ThumbnailProcessor (integration)', () => {
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

  describe('happy path (image)', () => {
    it('generates thumbnail and registers it', async () => {
      const userId = randomUUID()
      const imageBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer()

      const storageKey = `${userId}/${randomUUID()}.png`
      await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
      await writeFile(testApp.storage.pathFor(storageKey), imageBuffer)
      const record = await testApp.fileRepo.save(
        testApp.fileRepo.create({
          userId,
          storageKey,
          originalName: 'photo.png',
          mimeType: 'image/png',
          sizeBytes: imageBuffer.length,
          checksumSha256: createHash('sha256').update(imageBuffer).digest('hex'),
          purpose: 'original',
          assetId: null,
        }),
      )
      const asset = await testApp.assetRepo.save(
        testApp.assetRepo.create({ userId, kind: 'photo', fileId: record.id }),
      )

      const queue = testApp.getQueue('process-thumbnail')
      const job = await queue.add('thumbnail', {
        assetId: asset.id,
        fileId: record.id,
        size: 'sm',
        userId,
      })

      const state = await waitForJob(queue, job.id!)
      expect(state).toBe('completed')

      const thumb = await testApp.thumbRepo.findOne({ where: { assetId: asset.id, size: 'sm' } })
      expect(thumb).toBeTruthy()
      const thumbFile = await testApp.fileRepo.findOne({ where: { id: thumb!.fileId } })
      expect(thumbFile).toBeTruthy()
      expect(thumbFile!.mimeType).toBe('image/webp')
      const thumbStat = await testApp.storage.stat(thumbFile!.storageKey)
      expect(thumbStat.size).toBeGreaterThan(0)
      expect(Number(thumb!.bytes)).toBe(thumbStat.size)

      const updated = await testApp.assetRepo.findOne({ where: { id: asset.id } })
      expect(updated!.thumbnailStatus).toBe('ready')
    })
  })

  describe('error path', () => {
    it('marks thumbnail as failed when the source file is missing', async () => {
      const userId = randomUUID()
      const asset = await testApp.assetRepo.save(
        testApp.assetRepo.create({ userId, kind: 'photo', fileId: randomUUID() }),
      )

      const queue = testApp.getQueue('process-thumbnail')
      const job = await queue.add('thumbnail', {
        assetId: asset.id,
        fileId: randomUUID(),
        size: 'sm',
        userId,
      })

      const state = await waitForJob(queue, job.id!)
      expect(state).toBe('failed')

      const updated = await testApp.assetRepo.findOne({ where: { id: asset.id } })
      expect(updated!.thumbnailStatus).toBe('failed')
    })
  })
})
