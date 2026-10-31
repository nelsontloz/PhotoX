import { Logger } from '@nestjs/common'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { rm, mkdir, readFile } from 'fs/promises'
import { assetRefsJobSchema, bindingOf, type AssetRefsJob } from './job-schemas'
import { patchStatusFailed, runAssetFileJob } from './asset-file-job'
import type { ProcessorDeps, ProcessorSpec } from './processor-spec'
import { runFfmpeg, runFfprobeJson } from './ffmpeg'
import { parseFps } from './metadata.extractor'

const MAX_DURATION_SEC = 4 * 60 * 60
const MAX_DIMENSION = 7680
// web playback cap: phone slow-motion clips run ~240 fps, which is both heavy to encode
// and pointless in a browser; anything above this is resampled down (duration unchanged)
const MAX_ENCODE_FPS = 60
const TRANSCODE_TIMEOUT_MS = 60 * 60 * 1000

// ponytail: this exists. Replaces the older in-place replace path that overwrote the original bytes;
// originals are now immutable and derivatives live as separate FileRecord rows.
export async function registerDerivative(
  { core, storage }: Pick<ProcessorDeps, 'core' | 'storage'>,
  assetId: string,
  userId: string,
  outPath: string,
  sig?: string,
): Promise<string> {
  const bytes = await readFile(outPath)
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const fileId = randomUUID()
  const storageKey = storage.buildKey('transcode', userId, fileId, 'webm')
  await storage.save(storageKey, outPath)

  const saved = await core.registerFile(
    userId,
    {
      id: fileId,
      kind: 'transcode',
      ext: 'webm',
      checksumSha256: checksum,
      originalName: 'video.webm',
      mimeType: 'video/webm',
      sizeBytes: bytes.length,
      assetId,
    },
    // assetId rides in the body here, so the guard derives the scope without a header
    sig === undefined ? undefined : { sig },
  )
  // ponytail: checksum+assetId dedupe returned an existing derivative — drop our unreferenced copy
  if (saved.id !== fileId) await storage.delete(storageKey).catch(() => undefined)
  return saved.id
}

export function videoProcessor({
  core,
  storage,
}: Pick<ProcessorDeps, 'core' | 'storage'>): ProcessorSpec<AssetRefsJob> {
  const logger = new Logger('VideoProcessor')

  return {
    queue: 'process-video',
    logger,
    listening: 'Video processor listening for jobs',
    // ponytail: concurrency 2 bounds poison-video stall without CPU oversubscribe on a
    // personal host; raise only with abuse evidence (bullmq's default is 1)
    workerOptions: { concurrency: 2 },
    run: async (job) => {
      await runAssetFileJob({ core, storage, logger }, job, {
        queue: 'process-video',
        schema: assetRefsJobSchema,
        label: 'video transcode',
        failureLabel: 'Video transcode',
        missingModelMarkers: [],
        onFailure: ({ userId, assetId, message, sig }) =>
          patchStatusFailed(
            core,
            logger,
            userId,
            assetId,
            { transcodeStatus: 'failed', metadata: { transcodeError: message } },
            sig,
          ),
        body: async ({ data, filePath }) => {
          const { assetId, userId, sig } = data
          const binding = bindingOf(data)
          // only ffmpeg's output lives in tmp — the immutable original is read in place
          const outDir = join(tmpdir(), `${data.fileId}-transcode`)

          try {
            await core.patchMetadata(userId, assetId, { transcodeStatus: 'pending' }, binding)

            const probe = await runFfprobeJson(filePath)
            const duration = probe.format.duration ? Number.parseFloat(probe.format.duration) : 0
            const videoStream = probe.streams.find((s) => s.codec_type === 'video')
            const width = videoStream?.width ?? 0
            const height = videoStream?.height ?? 0

            if (duration > MAX_DURATION_SEC) {
              throw new Error(`Video duration ${duration}s exceeds ${MAX_DURATION_SEC}s limit`)
            }
            if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
              throw new Error(`Video dimensions ${width}x${height} exceed ${MAX_DIMENSION} limit`)
            }

            const videoCodec = videoStream?.codec_name ?? ''
            const audioStream = probe.streams.find((s) => s.codec_type === 'audio')
            const audioCodec = audioStream?.codec_name ?? ''
            const needsTranscode = videoCodec !== 'h264' || (audioStream && audioCodec !== 'aac')

            if (!needsTranscode) {
              await core.patchMetadata(
                userId,
                assetId,
                {
                  transcodeStatus: 'ready',
                  transcodeFileId: null,
                },
                binding,
              )
              logger.log(`Video already browser-safe, skipping transcode: asset=${assetId}`)
              return
            }

            await mkdir(outDir, { recursive: true })
            const outPath = join(outDir, 'output.webm')

            const scaleFilter = height > 720 ? `scale=-2:min(720\\,ih)` : undefined
            const sourceFps = parseFps(videoStream?.avg_frame_rate)
            // capping keeps the clip's duration/playback, only the frame count is resampled
            const fpsCapArgs =
              sourceFps !== null && sourceFps > MAX_ENCODE_FPS ? ['-r', String(MAX_ENCODE_FPS)] : []

            const ffmpegArgs = [
              '-y',
              '-i',
              filePath,
              '-c:v',
              'libsvtav1',
              '-preset',
              '8',
              '-crf',
              '32',
              '-pix_fmt',
              'yuv420p',
              ...fpsCapArgs,
              ...(scaleFilter ? ['-vf', scaleFilter] : []),
              ...(audioStream ? ['-c:a', 'libopus', '-b:a', '96k'] : []),
              outPath,
            ]

            await runFfmpeg(ffmpegArgs, { timeoutMs: TRANSCODE_TIMEOUT_MS })

            const derivativeFileId = await registerDerivative(
              { core, storage },
              assetId,
              userId,
              outPath,
              sig,
            )

            await core.patchMetadata(
              userId,
              assetId,
              {
                transcodeStatus: 'ready',
                transcodeFileId: derivativeFileId,
              },
              binding,
            )
            logger.log(`Video transcode complete: asset=${assetId}`)
          } finally {
            try {
              await rm(outDir, { recursive: true, force: true })
            } catch {
              // ignore cleanup errors
            }
          }
        },
      })
    },
  }
}
