import { execFile, type ChildProcess } from 'node:child_process';

// ponytail: ffmpeg-static/ffprobe-static ship binaries, not code — no types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegStatic: string | null = (require('ffmpeg-static') as string | null) ?? null;
const ffprobeBin: { path: string } | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('ffprobe-static') as { path: string } | null) ?? null;

export const FFMPEG_PATH: string | null = process.env.FFMPEG_PATH ?? ffmpegStatic;
const FFPROBE_PATH: string | null = process.env.FFPROBE_PATH ?? ffprobeBin?.path ?? null;

interface FfprobeStream {
  index: number;
  codec_name: string;
  codec_type: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
}

interface FfprobeFormat {
  filename: string;
  duration?: string;
  tags?: Record<string, string>;
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const SIGKILL_DELAY_MS = 5_000;
// stdout holds at most the frames runFfmpeg is asked to pipe (a few MB each); stderr only matters
// for the last 2000 chars of the error
const MAX_BUFFER = 64 * 1024 * 1024;

interface RunOptions {
  timeoutMs?: number;
  label?: string;
}

// ffmpeg can ignore SIGTERM mid-mux, and a stuck 1h transcode would hold CPU and a BullMQ slot —
// escalate to SIGKILL after a grace period
function killWithDelay(proc: ChildProcess) {
  const killTimer = setTimeout(() => {
    try {
      proc.kill('SIGKILL');
    } catch {
      // process already gone
    }
  }, SIGKILL_DELAY_MS);

  proc.once('exit', () => clearTimeout(killTimer));

  try {
    proc.kill('SIGTERM');
  } catch {
    // process already gone
  }
}

// execFile buffers stdout/stderr itself; the callback form (not promisify) keeps the child handle
// the timeout needs to escalate SIGTERM -> SIGKILL. label keeps the two error texts exact.
function runBin(
  bin: string,
  args: string[],
  { timeoutMs = DEFAULT_TIMEOUT_MS, label = 'process' }: RunOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const proc = execFile(
      bin,
      args,
      { encoding: 'buffer', maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        if (timedOut) return;
        clearTimeout(timer);
        if (!err) {
          resolve(stdout);
          return;
        }
        // spawn failures (ENOENT etc.) carry no numeric exit code — keep the original error
        if (typeof err.code !== 'number') {
          reject(new Error(err.message));
          return;
        }
        reject(
          new Error(`${label} exited with code ${err.code}: ${stderr.toString().slice(-2000)}`),
        );
      },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      killWithDelay(proc);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

export async function runFfmpeg(args: string[], options?: { timeoutMs?: number }): Promise<Buffer> {
  if (!FFMPEG_PATH)
    throw new Error('ffmpeg-static not found — install ffmpeg-static or set FFMPEG_PATH');
  return runBin(FFMPEG_PATH, args, { ...options, label: 'ffmpeg' });
}

export async function runFfprobeJson(input: string): Promise<FfprobeResult> {
  if (!FFPROBE_PATH)
    throw new Error('ffprobe-static not found — install ffprobe-static or set FFPROBE_PATH');

  const stdout = await runBin(
    FFPROBE_PATH,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input],
    { label: 'ffprobe' },
  );

  const raw = stdout.toString('utf-8');
  const parsed = JSON.parse(raw) as Partial<FfprobeResult>;

  return {
    streams: Array.isArray(parsed.streams) ? parsed.streams : [],
    format: parsed.format ?? { filename: input },
  };
}
