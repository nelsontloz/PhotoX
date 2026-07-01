import { spawn, type ChildProcess } from 'child_process'

// ponytail: ffmpeg-static/ffprobe-static ship binaries, not code — no types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegStatic: string | null = (require('ffmpeg-static') as string | null) ?? null
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const ffprobeBin: { path: string } | null =
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

function collect(
  stream: NodeJS.ReadableStream | null,
  mode: 'binary' | 'text',
): Promise<Buffer | string> {
  return new Promise((resolve, reject) => {
    if (!stream) {
      resolve(mode === 'binary' ? Buffer.alloc(0) : '')
      return
    }
    if (mode === 'binary') {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
    } else {
      const chunks: string[] = []
      stream.on('data', (chunk: Buffer | string) => chunks.push(String(chunk)))
      stream.on('end', () => resolve(chunks.join('')))
    }
    stream.on('error', reject)
  })
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
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const useStdioInput = options?.input !== undefined

  const stdio: ('ignore' | 'pipe')[] = useStdioInput
    ? ['pipe', 'pipe', 'pipe']
    : ['ignore', 'pipe', 'pipe']

  const proc = spawn(FFMPEG_PATH, args, { stdio })

  const stdoutPromise = collect(proc.stdout, 'binary') as Promise<Buffer>
  const stderrPromise = collect(proc.stderr, 'text') as Promise<string>

  let timer: ReturnType<typeof setTimeout> | undefined

  const result = await new Promise<{ stdout: Buffer; stderr: string; code: number }>(
    (resolve, reject) => {
      timer = setTimeout(() => {
        killWithDelay(proc)
        reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`))
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
        proc.stdin.end(options?.input)
      }
    },
  )

  if (result.code !== 0) {
    throw new Error(`ffmpeg exited with code ${result.code}: ${result.stderr.slice(-2000)}`)
  }

  return result
}

export async function runFfprobeJson(input: string): Promise<FfprobeResult> {
  if (!FFPROBE_PATH)
    throw new Error('ffprobe-static not found — install ffprobe-static or set FFPROBE_PATH')
  const proc = spawn(
    FFPROBE_PATH,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const stdoutPromise = collect(proc.stdout, 'binary') as Promise<Buffer>
  const stderrPromise = collect(proc.stderr, 'text') as Promise<string>

  const result = await new Promise<{ stdout: Buffer; stderr: string; code: number | null }>(
    (resolve, reject) => {
      proc.on('error', reject)
      proc.on('close', (code) => {
        void (async () => {
          const stdout = await stdoutPromise
          const stderr = await stderrPromise
          resolve({ stdout, stderr, code })
        })()
      })
    },
  )

  if (result.code !== 0) {
    throw new Error(`ffprobe exited with code ${result.code}: ${result.stderr.slice(-2000)}`)
  }

  const raw = result.stdout.toString('utf-8')
  const parsed = JSON.parse(raw) as Partial<FfprobeResult>

  return {
    streams: Array.isArray(parsed.streams) ? parsed.streams : [],
    format: parsed.format ?? { filename: input },
  }
}
