import { execSync } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { FFMPEG_PATH } from '../../src/queue/ffmpeg'
import { createTestApp, closeTestApp, resetDb, waitForJob, type TestApp } from './helpers'

const TEST_VIDEO_DIR = mkdtempSync(join(tmpdir(), 'video-test-'))
const H264_AAC_PATH = join(TEST_VIDEO_DIR, 'h264-aac.mp4')

function createH264AacVideo() {
  execSync(
    `"${FFMPEG_PATH}" -f lavfi -i color=c=black:s=320x240:d=1 -f lavfi -i anullsrc=r=44100:cl=mono -c:v libx264 -c:a aac -t 1 -y "${H264_AAC_PATH}"`,
    { timeout: 30_000, stdio: 'pipe' },
  )
  return readFileSync(H264_AAC_PATH)
}

function hasAomAv1(): boolean {
  try {
    execSync(`"${FFMPEG_PATH}" -encoders 2>/dev/null | grep libaom-av1`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('VideoProcessor (integration)', () => {
  let testApp: TestApp
  let h264AacBuffer: Buffer

  beforeAll(async () => {
    h264AacBuffer = createH264AacVideo()
    testApp = await createTestApp()
  }, 180_000)

  afterAll(async () => {
    await closeTestApp(testApp)
    if (existsSync(H264_AAC_PATH)) unlinkSync(H264_AAC_PATH)
    try {
      rmSync(TEST_VIDEO_DIR, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  beforeEach(async () => {
    await resetDb(testApp)
  })

  async function seedVideo(userId: string, bytes: Buffer, mimeType: string) {
    const storageKey = testApp.storage.buildKey('original', userId, randomUUID(), 'mp4')
    await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
    await writeFile(testApp.storage.pathFor(storageKey), bytes)
    const record = await testApp.fileRepo.save(
      testApp.fileRepo.create({
        userId,
        storageKey,
        originalName: 'video.mp4',
        mimeType,
        sizeBytes: bytes.length,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        purpose: 'original',
        assetId: null,
      }),
    )
    const asset = await testApp.assetRepo.save(
      testApp.assetRepo.create({ userId, kind: 'video', fileId: record.id }),
    )
    return { record, asset }
  }

  describe('skip transcode (h264+aac)', () => {
    it('skips transcode and marks ready', async () => {
      const userId = randomUUID()
      const { record, asset } = await seedVideo(userId, h264AacBuffer, 'video/mp4')

      const queue = testApp.getQueue('process-video')
      const job = await queue.add('video', {
        assetId: asset.id,
        fileId: record.id,
        userId,
      })

      const state = await waitForJob(queue, job.id!)
      expect(state).toBe('completed')

      const updated = await testApp.assetRepo.findOne({ where: { id: asset.id } })
      expect(updated!.transcodeStatus).toBe('ready')
      expect(updated!.transcodeFileId).toBeNull()

      const derivatives = await testApp.fileRepo.find({
        where: { purpose: 'transcode', assetId: asset.id },
      })
      expect(derivatives).toHaveLength(0)
    })
  })

  describe('transcode path', () => {
    it.skipIf(!hasAomAv1())(
      'transcodes non-h264 video and stores derivative',
      async () => {
        const transcodePath = join(TEST_VIDEO_DIR, 'mjpeg.avi')
        execSync(
          `"${FFMPEG_PATH}" -f lavfi -i color=c=black:s=320x240:d=1 -c:v mjpeg -pix_fmt yuvj420p -t 1 -y "${transcodePath}"`,
          { timeout: 30_000, stdio: 'pipe' },
        )
        const transcodeBuffer = readFileSync(transcodePath)

        const userId = randomUUID()
        const { record, asset } = await seedVideo(userId, transcodeBuffer, 'video/avi')

        const queue = testApp.getQueue('process-video')
        const job = await queue.add('video', {
          assetId: asset.id,
          fileId: record.id,
          userId,
        })

        const state = await waitForJob(queue, job.id!)
        expect(state).toBe('completed')

        const updated = await testApp.assetRepo.findOne({ where: { id: asset.id } })
        expect(updated!.transcodeStatus).toBe('ready')
        expect(updated!.transcodeFileId).toBeTruthy()

        const derivative = await testApp.fileRepo.findOne({
          where: { id: updated!.transcodeFileId! },
        })
        expect(derivative).toBeTruthy()
        expect(derivative!.purpose).toBe('transcode')
        expect(derivative!.mimeType).toBe('video/webm')
        const derivativeStat = await testApp.storage.stat(derivative!.storageKey)
        expect(derivativeStat.size).toBeGreaterThan(0)

        unlinkSync(transcodePath)
      },
      120_000,
    )
  })
})
