import { execSync } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { MetadataPatch, RegisterFileInput } from '../../src/core/core-client.service'
import { FFMPEG_PATH } from '../../src/queue/ffmpeg'
import {
  closeTestApp,
  createTestApp,
  resetTestApp,
  seedOriginal,
  waitForJob,
  type TestApp,
} from './helpers'

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
    testApp = await createTestApp({ processors: 'media' })
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

  beforeEach(() => resetTestApp(testApp))

  function patchDtos(): MetadataPatch[] {
    return testApp.fake.callsOf('patchMetadata').map((c) => c.args[1] as MetadataPatch)
  }

  describe('skip transcode (h264+aac)', () => {
    it('skips transcode and marks ready', async () => {
      const userId = randomUUID()
      const { record, asset } = await seedOriginal(testApp, {
        userId,
        bytes: h264AacBuffer,
        mimeType: 'video/mp4',
        ext: 'mp4',
      })

      const queue = testApp.getQueue('process-video')
      const job = await queue.add('video', { assetId: asset.id, fileId: record.id, userId })

      expect(await waitForJob(queue, job.id!)).toBe('completed')

      const updated = testApp.fake.assets.get(asset.id)!
      expect(updated.transcodeStatus).toBe('ready')
      expect(updated.transcodeFileId).toBeNull()
      expect(patchDtos()).toEqual([
        { transcodeStatus: 'pending' },
        { transcodeStatus: 'ready', transcodeFileId: null },
      ])
      expect(testApp.fake.callsOf('registerFile')).toHaveLength(0)
    })
  })

  describe('transcode path', () => {
    it.skipIf(!hasAomAv1())(
      'transcodes non-h264 video and registers the derivative before marking ready',
      async () => {
        const transcodePath = join(TEST_VIDEO_DIR, 'mjpeg.avi')
        execSync(
          `"${FFMPEG_PATH}" -f lavfi -i color=c=black:s=320x240:d=1 -c:v mjpeg -pix_fmt yuvj420p -t 1 -y "${transcodePath}"`,
          { timeout: 30_000, stdio: 'pipe' },
        )
        const transcodeBuffer = readFileSync(transcodePath)

        const userId = randomUUID()
        const { record, asset } = await seedOriginal(testApp, {
          userId,
          bytes: transcodeBuffer,
          mimeType: 'video/avi',
          ext: 'avi',
        })

        const queue = testApp.getQueue('process-video')
        const job = await queue.add('video', { assetId: asset.id, fileId: record.id, userId })

        expect(await waitForJob(queue, job.id!)).toBe('completed')

        const updated = testApp.fake.assets.get(asset.id)!
        expect(updated.transcodeStatus).toBe('ready')
        expect(updated.transcodeFileId).toBeTruthy()

        const dto = testApp.fake.callsOf('registerFile')[0]!.args[0] as RegisterFileInput
        expect(dto).toMatchObject({
          id: updated.transcodeFileId,
          kind: 'transcode',
          ext: 'webm',
          assetId: asset.id,
        })
        const derivative = testApp.fake.files.get(updated.transcodeFileId!)!
        expect(derivative.purpose).toBe('transcode')
        expect(derivative.mimeType).toBe('video/webm')
        const derivativeStat = await stat(testApp.storage.pathFor(derivative.storageKey))
        expect(derivativeStat.size).toBeGreaterThan(0)

        // register-before-patch ordering: ready patch carries the registered id
        const lastPatch = patchDtos().at(-1)!
        expect(lastPatch).toEqual({
          transcodeStatus: 'ready',
          transcodeFileId: updated.transcodeFileId,
        })

        unlinkSync(transcodePath)
      },
      120_000,
    )
  })

  describe('failure path', () => {
    it('marks transcode failed with the error message when probing fails', async () => {
      const userId = randomUUID()
      const { record, asset } = await seedOriginal(testApp, {
        userId,
        bytes: Buffer.from('not a video'),
        mimeType: 'video/mp4',
        ext: 'mp4',
      })

      const queue = testApp.getQueue('process-video')
      const job = await queue.add('video', { assetId: asset.id, fileId: record.id, userId })

      expect(await waitForJob(queue, job.id!)).toBe('failed')

      const updated = testApp.fake.assets.get(asset.id)!
      expect(updated.transcodeStatus).toBe('failed')
      const errorPatch = patchDtos().at(-1)!
      expect(errorPatch.transcodeStatus).toBe('failed')
      expect(errorPatch.metadata?.transcodeError).toEqual(expect.any(String))
    })
  })
})
