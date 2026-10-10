import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { makeAsset, makeFileRecord } from '../fake-core-client'
import { FFMPEG_PATH } from '../../src/queue/ffmpeg'
import {
  closeTestApp,
  createTestApp,
  resetTestApp,
  seedOriginal,
  waitForJob,
  type TestApp,
} from './helpers'

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'metadata-int-'))
const VIDEO_PATH = join(FIXTURE_DIR, 'h264-aac.mp4')

function makeH264AacMp4(): Buffer {
  if (!FFMPEG_PATH) throw new Error('ffmpeg binary not available')
  execFileSync(
    FFMPEG_PATH,
    [
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
      '-y',
      VIDEO_PATH,
    ],
    { timeout: 30_000, stdio: 'pipe' },
  )
  return readFileSync(VIDEO_PATH)
}

describe('MetadataProcessor (integration)', () => {
  let testApp: TestApp
  let videoBuffer: Buffer

  beforeAll(async () => {
    videoBuffer = makeH264AacMp4()
    testApp = await createTestApp({ processors: 'media' })
  }, 180_000)

  afterAll(async () => {
    await closeTestApp(testApp)
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  })

  beforeEach(() => resetTestApp(testApp))

  async function runMetadata(assetId: string, fileId: string, userId: string) {
    const queue = testApp.getQueue('process-metadata')
    const job = await queue.add('metadata', { assetId, fileId, userId })
    return { queue, job }
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

    const { queue, job } = await runMetadata(asset.id, record.id, userId)
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

    expect(testApp.fake.callsOf('patchMetadata').at(-1)!.args[1]).toMatchObject({
      status: 'ready',
      metadata: null,
    })
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

    const { queue, job } = await runMetadata(asset.id, fileId, userId)
    expect(await waitForJob(queue, job.id!)).toBe('failed')

    expect(testApp.fake.callsOf('patchMetadata').at(-1)!.args[1]).toEqual({ status: 'failed' })
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
