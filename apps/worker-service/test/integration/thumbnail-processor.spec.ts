import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { RegisterFileInput } from '../../src/core/core-client.service'
import { makeAsset, makeFileRecord } from '../fake-core-client'
import {
  closeTestApp,
  createTestApp,
  resetTestApp,
  seedOriginal,
  waitForJob,
  type TestApp,
} from './helpers'

describe('ThumbnailProcessor (integration)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await createTestApp({ processors: 'media' })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(testApp)
  })

  beforeEach(() => resetTestApp(testApp))

  describe('happy path (image)', () => {
    it('generates a thumbnail, registers its file and marks the asset ready', async () => {
      const userId = randomUUID()
      const imageBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer()
      const { record, asset } = await seedOriginal(testApp, {
        userId,
        bytes: imageBuffer,
        mimeType: 'image/png',
        ext: 'png',
      })

      const queue = testApp.getQueue('process-thumbnail')
      const job = await queue.add('thumbnail', {
        assetId: asset.id,
        fileId: record.id,
        size: 'sm',
        userId,
      })

      expect(await waitForJob(queue, job.id!)).toBe('completed')

      const thumb = testApp.fake.thumbnails[0]!
      expect(thumb).toMatchObject({ assetId: asset.id, size: 'sm' })

      const dto = testApp.fake.callsOf('registerFile')[0]!.args[0] as RegisterFileInput
      expect(dto).toMatchObject({
        kind: 'thumbnail',
        ext: 'webp',
        mimeType: 'image/webp',
        originalName: 'thumb-sm.webp',
      })
      const registered = testApp.fake.files.get(dto.id)!
      expect(registered.mimeType).toBe('image/webp')
      const thumbStat = await testApp.storage.stat(registered.storageKey)
      expect(thumbStat.size).toBe(thumb.bytes)

      expect(testApp.fake.callsOf('patchMetadata').at(-1)!.args[1]).toEqual({
        thumbnailStatus: 'ready',
      })
      expect(testApp.fake.assets.get(asset.id)!.thumbnailStatus).toBe('ready')
    })
  })

  describe('dedupe path', () => {
    it('reuses the first file id on a checksum hit and drops the duplicate copy', async () => {
      testApp.fake.dedupeRegistrations = true
      const userId = randomUUID()
      const imageBuffer = await sharp({
        create: { width: 64, height: 64, channels: 3, background: 'blue' },
      })
        .png()
        .toBuffer()
      const { record, asset } = await seedOriginal(testApp, {
        userId,
        bytes: imageBuffer,
        mimeType: 'image/png',
        ext: 'png',
      })

      const queue = testApp.getQueue('process-thumbnail')
      const payload = { assetId: asset.id, fileId: record.id, size: 'sm' as const, userId }
      const first = await queue.add('thumbnail', payload)
      expect(await waitForJob(queue, first.id!)).toBe('completed')
      const second = await queue.add('thumbnail', payload)
      expect(await waitForJob(queue, second.id!)).toBe('completed')

      const dtos = testApp.fake.callsOf('registerFile').map((c) => c.args[0] as RegisterFileInput)
      expect(dtos).toHaveLength(2)
      expect(dtos[1]!.id).not.toBe(dtos[0]!.id)
      expect(testApp.fake.thumbnails[1]!.fileId).toBe(dtos[0]!.id)
      expect(testApp.fake.files.has(dtos[1]!.id)).toBe(false)

      const dedupedKey = testApp.storage.buildKey('thumbnail', userId, dtos[1]!.id, 'webp')
      const keptKey = testApp.storage.buildKey('thumbnail', userId, dtos[0]!.id, 'webp')
      expect(await testApp.storage.exists(dedupedKey)).toBe(false)
      expect(await testApp.storage.exists(keptKey)).toBe(true)
    })
  })

  describe('error path', () => {
    it('marks thumbnail as failed when the source file is missing', async () => {
      const userId = randomUUID()
      const fileId = randomUUID()
      testApp.fake.files.set(
        fileId,
        makeFileRecord({
          id: fileId,
          userId,
          storageKey: testApp.storage.buildKey('original', userId, fileId, 'png'),
          mimeType: 'image/png',
        }),
      )
      const asset = makeAsset({ id: randomUUID(), userId, fileId, kind: 'photo' })
      testApp.fake.assets.set(asset.id, asset)

      const queue = testApp.getQueue('process-thumbnail')
      const job = await queue.add('thumbnail', { assetId: asset.id, fileId, size: 'sm', userId })

      expect(await waitForJob(queue, job.id!)).toBe('failed')

      expect(testApp.fake.callsOf('patchMetadata').at(-1)!.args[1]).toEqual({
        thumbnailStatus: 'failed',
      })
      expect(testApp.fake.assets.get(asset.id)!.thumbnailStatus).toBe('failed')
    })
  })
})
