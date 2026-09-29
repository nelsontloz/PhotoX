import { spawn, type ChildProcess } from 'child_process'
import { buffer, text } from 'stream/consumers'

// ponytail: ffmpeg-static/ffprobe-static ship binaries, not code — no types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegStatic: string | null = (require('ffmpeg-static') as string | null) ?? null
const ffprobeBin: { path: string } | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  (require('ffprobe-static') as { path: string } | null) ?? null

export const FFMPEG_PATH: string | null = process.env.FFMPEG_PATH ?? ffmpegStatic
export const FFPROBE_PATH: string | null = process.env.FFPROBE_PATH ?? ffprobeBin?.path ?? null

export interface FfprobeStream {
  index: number
  codec_name: string
  codec_type: string
  width?: number
  height?: number
  avg_frame_rate?: string
  tags?: Record<string, string>
  side_data_list?: { side_data_type?: string; rotation?: number }[]
}

export interface FfprobeFormat {
  filename: string
  duration?: string
  tags?: Record<string, string>
}

export interface FfprobeResult {
  streams: FfprobeStream[]
  format: FfprobeFormat
}

const DEFAULT_TIMEOUT_MS = 120_000
const SIGKILL_DELAY_MS = 5_000

interface RunOptions {
  input?: Buffer
  timeoutMs?: number
  label?: string
}

// ponytail: ffmpeg and ffprobe share the spawn/timeout/kill loop; label keeps the two error texts exact
async function runBin(
  bin: string,
  args: string[],
  { input, timeoutMs = DEFAULT_TIMEOUT_MS, label = 'process' }: RunOptions = {},
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  const useStdioInput = input !== undefined

  const proc = spawn(bin, args, {
    stdio: useStdioInput ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  })

  const stdoutPromise = proc.stdout ? buffer(proc.stdout) : Promise.resolve(Buffer.alloc(0))
  const stderrPromise = proc.stderr ? text(proc.stderr) : Promise.resolve('')

  let timer: ReturnType<typeof setTimeout> | undefined

  const result = await new Promise<{ stdout: Buffer; stderr: string; code: number }>(
    (resolve, reject) => {
      timer = setTimeout(() => {
        killWithDelay(proc)
        reject(new Error(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        void (async () => {
          const stdout = await stdoutPromise
          const stderr = await stderrPromise
          resolve({ stdout, stderr, code: code ?? 1 })
        })()
      })

      if (useStdioInput && proc.stdin) {
        proc.stdin.end(input)
      }
    },
  )

  if (result.code !== 0) {
    throw new Error(`${label} exited with code ${result.code}: ${result.stderr.slice(-2000)}`)
  }

  return result
}

function killWithDelay(proc: ChildProcess) {
  const killTimer = setTimeout(() => {
    try {
      proc.kill('SIGKILL')
    } catch {
      // process already gone
    }
  }, SIGKILL_DELAY_MS)

  proc.once('exit', () => clearTimeout(killTimer))

  try {
    proc.kill('SIGTERM')
  } catch {
    // process already gone
  }
}

export async function runFfmpeg(
  args: string[],
  options?: { input?: Buffer; timeoutMs?: number },
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  if (!FFMPEG_PATH)
    throw new Error('ffmpeg-static not found — install ffmpeg-static or set FFMPEG_PATH')
  return runBin(FFMPEG_PATH, args, { ...options, label: 'ffmpeg' })
}

export async function runFfprobeJson(input: string): Promise<FfprobeResult> {
  if (!FFPROBE_PATH)
    throw new Error('ffprobe-static not found — install ffprobe-static or set FFPROBE_PATH')

  const { stdout } = await runBin(
    FFPROBE_PATH,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input],
    { label: 'ffprobe' },
  )

  const raw = stdout.toString('utf-8')
  const parsed = JSON.parse(raw) as Partial<FfprobeResult>

  return {
    streams: Array.isArray(parsed.streams) ? parsed.streams : [],
    format: parsed.format ?? { filename: input },
  }
}
