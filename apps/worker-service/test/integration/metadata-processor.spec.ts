import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { makeAsset, makeFileRecord } from '../fake-core-client'
import {
  closeTestApp,
  createTestApp,
  makeVideoFixture,
  resetTestApp,
  seedOriginal,
  signJob,
  waitForJob,
  type TestApp,
} from './helpers'

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'metadata-int-'))
const VIDEO_PATH = join(FIXTURE_DIR, 'h264-aac.mp4')

function makeH264AacMp4(): Buffer {
  return makeVideoFixture(VIDEO_PATH, [
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x240:d=1',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-t',
    '1',
  ])
}

describe('MetadataProcessor (integration)', () => {
  let testApp: TestApp
  let videoBuffer: Buffer

  beforeAll(async () => {
    videoBuffer = makeH264AacMp4()
    testApp = await createTestApp()
  }, 180_000)

  afterAll(async () => {
    await closeTestApp(testApp)
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  })

  beforeEach(() => resetTestApp(testApp))

  async function runMetadata(assetId: string, fileId: string, userId: string) {
    const queue = testApp.getQueue('process-metadata')
    const data = signJob({ assetId, fileId, userId })
    const job = await queue.add('metadata', data)
    return { queue, job, sig: data.sig }
  }

  it('extracts dimensions and EXIF from a real JPEG', async () => {
    const userId = randomUUID()
    const bytes = await sharp({
      create: { width: 100, height: 80, channels: 3, background: 'red' },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: 'TestMake', Model: 'TestModel' },
        IFD2: { DateTimeOriginal: '2024:06:15 14:30:00' },
      })
      .toBuffer()
    const { record, asset } = await seedOriginal(testApp, {
      userId,
      bytes,
      mimeType: 'image/jpeg',
      ext: 'jpg',
    })

    const { queue, job, sig } = await runMetadata(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const updated = testApp.fake.assets.get(asset.id)!
    expect(updated.metadataStatus).toBe('ready')
    expect(updated.width).toBe(100)
    expect(updated.height).toBe(80)
    expect(updated.cameraMake).toBe('TestMake')
    expect(updated.cameraModel).toBe('TestModel')
    expect(updated.takenAt).toBe('2024-06-15T14:30:00.000Z')
    expect(updated.mimeType).toBe('image/jpeg')
    expect(updated.originalName).toBe('source.jpg')
    expect(updated.sizeBytes).toBe(bytes.length)
    expect(updated.metadataExtractedAt).toBeTruthy()

    const successPatch = testApp.fake.callsOf('patchMetadata').at(-1)!
    expect(successPatch.args[1]).toMatchObject({
      status: 'ready',
      metadata: null,
    })
    expect(successPatch.binding).toEqual({ sig, scope: asset.id })
  })

  it('reports display dimensions and offset-corrected takenAt for a rotated phone JPEG', async () => {
    const userId = randomUUID()
    const bytes = await sharp({
      create: { width: 100, height: 80, channels: 3, background: 'red' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({
        IFD2: { DateTimeOriginal: '2024:06:15 14:30:00', OffsetTimeOriginal: '+02:00' },
      })
      .toBuffer()
    const { record, asset } = await seedOriginal(testApp, {
      userId,
      bytes,
      mimeType: 'image/jpeg',
      ext: 'jpg',
    })

    const { queue, job } = await runMetadata(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const updated = testApp.fake.assets.get(asset.id)!
    expect(updated.orientation).toBe(6)
    // coded 100×80 tagged Orientation=6 → displayed 80×100
    expect(updated.width).toBe(80)
    expect(updated.height).toBe(100)
    expect(updated.takenAt).toBe('2024-06-15T12:30:00.000Z')
  })

  it('keeps a client-supplied takenAt when the photo carries no EXIF date', async () => {
    const userId = randomUUID()
    const bytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: 'blue' },
    })
      .jpeg()
      .toBuffer()
    const { record, asset } = await seedOriginal(testApp, {
      userId,
      bytes,
      mimeType: 'image/jpeg',
      ext: 'jpg',
      asset: { takenAt: '2024-01-02T03:04:05.000Z' },
    })

    const { queue, job } = await runMetadata(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    expect(testApp.fake.callsOf('patchMetadata').at(-1)!.args[1]).not.toHaveProperty('takenAt')
    expect(testApp.fake.assets.get(asset.id)!.takenAt).toBe('2024-01-02T03:04:05.000Z')
  })

  it('extracts duration, dimensions and codec from a real mp4', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedOriginal(testApp, {
      userId,
      bytes: videoBuffer,
      mimeType: 'video/mp4',
      ext: 'mp4',
    })

    const { queue, job } = await runMetadata(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    const updated = testApp.fake.assets.get(asset.id)!
    expect(updated.metadataStatus).toBe('ready')
    expect(updated.durationSeconds).toBeCloseTo(1, 1)
    expect(updated.width).toBe(320)
    expect(updated.height).toBe(240)
    expect(updated.codec).toBe('h264')
    expect(updated.fps).toBeCloseTo(25, 1)
    expect(updated.hasAudio).toBe(true)
    expect(updated.metadata).toBeNull()
    expect(updated.sizeBytes).toBe(videoBuffer.length)
  })

  it('leaves metadata untouched for an unknown mime type', async () => {
    const userId = randomUUID()
    const bytes = Buffer.from('%PDF-1.4 not really a pdf')
    const { record, asset } = await seedOriginal(testApp, {
      userId,
      bytes,
      mimeType: 'application/pdf',
      ext: 'pdf',
    })

    const { queue, job } = await runMetadata(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    expect(testApp.fake.callsOf('patchMetadata')).toHaveLength(0)
    const updated = testApp.fake.assets.get(asset.id)!
    expect(updated.metadataStatus).toBe('pending')
    expect(updated.metadataExtractedAt).toBeNull()
  })

  it('marks metadata failed when the source file is missing', async () => {
    const userId = randomUUID()
    const fileId = randomUUID()
    testApp.fake.files.set(
      fileId,
      makeFileRecord({
        id: fileId,
        userId,
        storageKey: testApp.storage.buildKey('original', userId, fileId, 'jpg'),
        mimeType: 'image/jpeg',
      }),
    )
    const asset = makeAsset({ id: randomUUID(), userId, fileId, kind: 'photo' })
    testApp.fake.assets.set(asset.id, asset)

    const { queue, job, sig } = await runMetadata(asset.id, fileId, userId)
    expect(await waitForJob(queue, job.id!)).toBe('failed')

    const failurePatch = testApp.fake.callsOf('patchMetadata').at(-1)!
    expect(failurePatch.args[1]).toEqual({ status: 'failed' })
    // patchStatusFailed threads the signature alone — the route derives the scope from the path
    expect(failurePatch.binding).toEqual({ sig })
    expect(testApp.fake.assets.get(asset.id)!.metadataStatus).toBe('failed')
  })

  it('stores the record sizeBytes instead of stat-ing the local copy', async () => {
    const userId = randomUUID()
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: 'green' },
    })
      .jpeg()
      .toBuffer()
    const { record, asset } = await seedOriginal(testApp, {
      userId,
      bytes,
      mimeType: 'image/jpeg',
      ext: 'jpg',
    })
    // size the record differently from the bytes on disk to prove the fetched DTO is the source
    record.sizeBytes = 4242
    testApp.fake.files.set(record.id, record)

    const { queue, job } = await runMetadata(asset.id, record.id, userId)
    expect(await waitForJob(queue, job.id!)).toBe('completed')

    expect(testApp.fake.assets.get(asset.id)!.sizeBytes).toBe(4242)
  })
})
