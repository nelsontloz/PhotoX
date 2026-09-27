import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { FFMPEG_PATH } from '../../src/queue/ffmpeg'
import { createTestApp, closeTestApp, resetDb, waitForJob, type TestApp } from './helpers'

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'video-thumb-rot-'))
const LANDSCAPE_PATH = join(FIXTURE_DIR, 'landscape.mp4')

function makeLandscapeMp4(): Buffer {
  if (!FFMPEG_PATH) throw new Error('ffmpeg binary not available')
  execFileSync(
    FFMPEG_PATH,
    [
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x240:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-t',
      '1',
      '-y',
      LANDSCAPE_PATH,
    ],
    { timeout: 30_000, stdio: 'pipe' },
  )
  return readFileSync(LANDSCAPE_PATH)
}

describe('VideoThumbnailRotation (integration)', () => {
  let testApp: TestApp
  let landscapeBuffer: Buffer

  beforeAll(async () => {
    landscapeBuffer = makeLandscapeMp4()
    testApp = await createTestApp()
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(testApp)
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await resetDb(testApp)
  })

  async function seedVideo(
    userId: string,
    orientation: number | null,
    metadataStatus: 'pending' | 'ready',
    durationSeconds: number | null,
  ) {
    const storageKey = testApp.storage.buildKey('original', userId, randomUUID(), 'mp4')
    await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
    await writeFile(testApp.storage.pathFor(storageKey), landscapeBuffer)
    const record = await testApp.fileRepo.save(
      testApp.fileRepo.create({
        userId,
        storageKey,
        originalName: 'video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: landscapeBuffer.length,
        checksumSha256: createHash('sha256').update(landscapeBuffer).digest('hex'),
        purpose: 'original',
        assetId: null,
      }),
    )
    const asset = await testApp.assetRepo.save(
      testApp.assetRepo.create({
        userId,
        kind: 'video',
        fileId: record.id,
        orientation,
        metadataStatus,
        durationSeconds,
      }),
    )
    return { record, asset }
  }

  async function runLgThumbnail(assetId: string, fileId: string, userId: string) {
    const queue = testApp.getQueue('process-thumbnail')
    const job = await queue.add('thumbnail', { assetId, fileId, size: 'lg', userId })
    const state = await waitForJob(queue, job.id!)
    expect(state).toBe('completed')
    const updated = await testApp.assetRepo.findOne({ where: { id: assetId } })
    expect(updated!.thumbnailStatus).toBe('ready')
    const thumb = await testApp.thumbRepo.findOne({ where: { assetId, size: 'lg' } })
    expect(thumb).toBeTruthy()
    const thumbFile = await testApp.fileRepo.findOne({ where: { id: thumb!.fileId } })
    expect(thumbFile).toBeTruthy()
    const bytes = await readFile(testApp.storage.pathFor(thumbFile!.storageKey))
    return sharp(bytes).metadata()
  }

  it('rotates portrait for orientation 90', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, 90, 'ready', 1)
    const meta = await runLgThumbnail(asset.id, record.id, userId)
    expect(meta.height).toBeGreaterThan(meta.width)
  })

  it('rotates portrait for orientation -90', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, -90, 'ready', 1)
    const meta = await runLgThumbnail(asset.id, record.id, userId)
    expect(meta.height).toBeGreaterThan(meta.width)
  })

  it('passes landscape through for orientation null', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, null, 'ready', 1)
    const meta = await runLgThumbnail(asset.id, record.id, userId)
    expect(meta.width).toBeGreaterThan(meta.height)
  })

  it('completes unrotated when metadata stays pending', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, null, 'pending', null)
    const meta = await runLgThumbnail(asset.id, record.id, userId)
    expect(meta.width).toBeGreaterThan(meta.height)
  }, 30_000)
})
