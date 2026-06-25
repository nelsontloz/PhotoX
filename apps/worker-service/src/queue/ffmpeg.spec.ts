import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { unlinkSync } from 'fs'
import { runFfprobeJson, runFfmpeg, FFMPEG_PATH } from './ffmpeg'

const fixturePath = join(tmpdir(), 'test-fixture.mp4')

function ffmpegAvailable(): boolean {
  try {
    execSync(`${FFMPEG_PATH} -version`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function generateFixture(): void {
  if (existsSync(fixturePath)) return
  execSync(
    `${FFMPEG_PATH} -y -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${fixturePath}"`,
    { stdio: 'ignore', timeout: 30_000 },
  )
}

function cleanup(): void {
  try {
    if (existsSync(fixturePath)) unlinkSync(fixturePath)
  } catch {
    // ignore
  }
}

const HAS_FFMPEG = ffmpegAvailable()

const describeIfFfmpeg = HAS_FFMPEG ? describe : describe.skip

describeIfFfmpeg('ffmpeg wrapper', () => {
  beforeAll(() => {
    generateFixture()
  })

  afterAll(() => {
    cleanup()
  })

  it('runFfprobeJson returns streams and format for a real mp4', async () => {
    const result = await runFfprobeJson(fixturePath)

    expect(result.streams.length).toBeGreaterThanOrEqual(1)
    expect(result.format.filename).toBeTruthy()

    const videoStream = result.streams.find((s) => s.codec_type === 'video')
    expect(videoStream).toBeDefined()
    expect(videoStream!.width).toBe(320)
    expect(videoStream!.height).toBe(240)
    expect(videoStream!.codec_name).toBeTruthy()
    expect(videoStream!.avg_frame_rate).toBeTruthy()

    const audioStream = result.streams.find((s) => s.codec_type === 'audio')
    expect(audioStream).toBeDefined()

    expect(result.format.duration).toBeDefined()
    expect(Number.parseFloat(result.format.duration!)).toBeGreaterThan(0)
  })

  it('extractVideoFrame returns a non-empty JPEG buffer', async () => {
    const result = await runFfmpeg([
      '-y',
      '-ss',
      '1',
      '-i',
      fixturePath,
      '-vframes',
      '1',
      '-f',
      'image2pipe',
      '-',
    ])
    const buffer = result.stdout

    expect(buffer.length).toBeGreaterThan(0)

    expect(buffer[0]).toBe(0xff)
    expect(buffer[1]).toBe(0xd8)
    expect(buffer[2]).toBe(0xff)
  })

  it('runFfmpeg with invalid arg rejects with non-zero exit', async () => {
    await expect(runFfmpeg(['-help_that_does_not_exist'])).rejects.toThrow()
  })
})

describeIfFfmpeg('skip notice', () => {
  it('logs that ffmpeg is available', () => {
    console.log('[ffmpeg.spec.ts] ffmpeg is available — running full test suite')
  })
})

if (!HAS_FFMPEG) {
  it('skips all ffmpeg tests — ffmpeg not found on PATH', () => {
    console.log(`[ffmpeg.spec.ts] ffmpeg not found at ${FFMPEG_PATH} — all tests skipped`)
  })
}
