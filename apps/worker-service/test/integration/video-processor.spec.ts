import { execSync } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestApp, closeTestApp, waitForJob, type TestApp } from './helpers'

const TEST_VIDEO_DIR = mkdtempSync(join(tmpdir(), 'video-test-'))
const H264_AAC_PATH = join(TEST_VIDEO_DIR, 'h264-aac.mp4')

function createH264AacVideo() {
  execSync(
    `ffmpeg -f lavfi -i color=c=black:s=320x240:d=1 -f lavfi -i anullsrc=r=44100:cl=mono -c:v libx264 -c:a aac -t 1 -y "${H264_AAC_PATH}"`,
    { timeout: 30_000, stdio: 'pipe' },
  )
  return readFileSync(H264_AAC_PATH)
}

function hasSvtAv1(): boolean {
  try {
    execSync('ffmpeg -encoders 2>/dev/null | grep libsvtav1', { stdio: 'ignore' })
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
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(testApp)
    if (existsSync(H264_AAC_PATH)) unlinkSync(H264_AAC_PATH)
    try {
      import('node:fs').then((fs) => fs.rmdirSync(TEST_VIDEO_DIR))
    } catch {
      // ignore
    }
  })

  beforeEach(() => {
    testApp.stub.clearRoutes()
    testApp.stub.resetCalls()
  })

  describe('skip transcode (h264+aac)', () => {
    it('skips transcode and marks ready', async () => {
      const port = testApp.stub.port

      testApp.stub.setResponse('GET', '/v1/files/test-file-id/url', (_call, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ url: `http://localhost:${port}/test-video.mp4` }))
      })

      testApp.stub.setResponse('GET', '/test-video.mp4', (_call, res) => {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': String(h264AacBuffer.length),
        })
        res.end(h264AacBuffer)
      })

      testApp.stub.setResponse('PATCH', /\/v1\/assets\/[^/]+\/metadata/, (_call, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({}))
      })

      testApp.stub.setResponse('POST', '/v1/files/derivatives', (_call, res) => {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'derivative-file-id' }))
      })

      const queue = testApp.getQueue('process-video')
      const job = await queue.add('video', {
        assetId: 'test-asset-id',
        fileId: 'test-file-id',
        userId: 'test-user-id',
      })

      const state = await waitForJob(queue, job.id!)
      expect(state).toBe('completed')

      const calls = testApp.stub.calls

      const getUrlCalls = calls.filter(
        (c) => c.method === 'GET' && c.url.startsWith('/v1/files/test-file-id/url'),
      )
      expect(getUrlCalls).toHaveLength(1)

      const downloadCalls = calls.filter((c) => c.method === 'GET' && c.url === '/test-video.mp4')
      expect(downloadCalls).toHaveLength(1)

      const patchCalls = calls.filter(
        (c) => c.method === 'PATCH' && /\/v1\/assets\/[^/]+\/metadata/.test(c.url),
      )
      expect(patchCalls).toHaveLength(2)
      expect(JSON.parse(patchCalls[0]!.body.toString())).toEqual({ transcodeStatus: 'pending' })
      expect(JSON.parse(patchCalls[1]!.body.toString())).toEqual({
        transcodeStatus: 'ready',
        transcodeFileId: null,
      })

      const derivativeCalls = calls.filter(
        (c) => c.method === 'POST' && c.url === '/v1/files/derivatives',
      )
      expect(derivativeCalls).toHaveLength(0)
    })
  })

  describe('transcode path', () => {
    it.skipIf(!hasSvtAv1())(
      'transcodes non-h264 video and uploads derivative',
      async () => {
        const transcodePath = join(TEST_VIDEO_DIR, 'mjpeg.avi')
        execSync(
          `ffmpeg -f lavfi -i color=c=black:s=320x240:d=1 -c:v mjpeg -pix_fmt yuvj420p -t 1 -y "${transcodePath}"`,
          { timeout: 30_000, stdio: 'pipe' },
        )
        const transcodeBuffer = readFileSync(transcodePath)

        const port = testApp.stub.port

        testApp.stub.setResponse('GET', '/v1/files/transcode-file-id/url', (_call, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ url: `http://localhost:${port}/source-video.avi` }))
        })

        testApp.stub.setResponse('GET', '/source-video.avi', (_call, res) => {
          res.writeHead(200, {
            'Content-Type': 'video/avi',
            'Content-Length': String(transcodeBuffer.length),
          })
          res.end(transcodeBuffer)
        })

        testApp.stub.setResponse('PATCH', /\/v1\/assets\/[^/]+\/metadata/, (_call, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({}))
        })

        testApp.stub.setResponse('POST', '/v1/files/derivatives', (_call, res) => {
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ id: 'derivative-file-id' }))
        })

        const queue = testApp.getQueue('process-video')
        const job = await queue.add('video', {
          assetId: 'test-asset-id',
          fileId: 'transcode-file-id',
          userId: 'test-user-id',
        })

        const state = await waitForJob(queue, job.id!)
        expect(state).toBe('completed')

        const calls = testApp.stub.calls

        const derivativeCalls = calls.filter(
          (c) => c.method === 'POST' && c.url === '/v1/files/derivatives',
        )
        expect(derivativeCalls).toHaveLength(1)

        const patchCalls = calls.filter(
          (c) => c.method === 'PATCH' && /\/v1\/assets\/[^/]+\/metadata/.test(c.url),
        )
        expect(patchCalls).toHaveLength(2)
        expect(JSON.parse(patchCalls[0]!.body.toString())).toEqual({ transcodeStatus: 'pending' })
        expect(JSON.parse(patchCalls[1]!.body.toString())).toEqual({
          transcodeStatus: 'ready',
          transcodeFileId: 'derivative-file-id',
        })

        unlinkSync(transcodePath)
      },
      120_000,
    )
  })
})
