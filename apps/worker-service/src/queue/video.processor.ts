import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { rm, mkdir, readFile } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { assetRefsJobSchema, bindingOf, type AssetRefsJob } from './job-schemas'
import { patchStatusFailed, runAssetFileJob } from './asset-file-job'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'
import { runFfmpeg, runFfprobeJson } from './ffmpeg'

const MAX_DURATION_SEC = 4 * 60 * 60
const MAX_DIMENSION = 7680
const TRANSCODE_TIMEOUT_MS = 60 * 60 * 1000

@Injectable()
export class VideoProcessor implements OnModuleInit {
  private readonly logger = new Logger(VideoProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
  ) {}

  onModuleInit() {
    // ponytail: concurrency 2 bounds poison-video stall without CPU oversubscribe on a
    // personal host; raise only with abuse evidence (bullmq's default is 1)
    this.bullMq.createWorker<AssetRefsJob>('process-video', (job) => this.processJob(job), {
      concurrency: 2,
    })

    this.logger.log('Video processor listening for jobs')
  }

  private async processJob(job: Job<AssetRefsJob>) {
    await runAssetFileJob({ core: this.core, storage: this.storage, logger: this.logger }, job, {
      queue: 'process-video',
      schema: assetRefsJobSchema,
      label: 'video transcode',
      failureLabel: 'Video transcode',
      missingModelMarkers: [],
      onFailure: ({ userId, assetId, message, sig }) =>
        patchStatusFailed(
          this.core,
          this.logger,
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
          await this.core.patchMetadata(userId, assetId, { transcodeStatus: 'pending' }, binding)

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
            await this.core.patchMetadata(
              userId,
              assetId,
              {
                transcodeStatus: 'ready',
                transcodeFileId: null,
              },
              binding,
            )
            this.logger.log(`Video already browser-safe, skipping transcode: asset=${assetId}`)
            return
          }

          await mkdir(outDir, { recursive: true })
          const outPath = join(outDir, 'output.webm')

          const scaleFilter = height > 720 ? `scale=-2:min(720\\,ih)` : undefined

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
            ...(scaleFilter ? ['-vf', scaleFilter] : []),
            ...(audioStream ? ['-c:a', 'libopus', '-b:a', '96k'] : []),
            outPath,
          ]

          await runFfmpeg(ffmpegArgs, { timeoutMs: TRANSCODE_TIMEOUT_MS })

          const derivativeFileId = await this.registerDerivative(assetId, userId, outPath, sig)

          await this.core.patchMetadata(
            userId,
            assetId,
            {
              transcodeStatus: 'ready',
              transcodeFileId: derivativeFileId,
            },
            binding,
          )
          this.logger.log(`Video transcode complete: asset=${assetId}`)
        } finally {
          try {
            await rm(outDir, { recursive: true, force: true })
          } catch {
            // ignore cleanup errors
          }
        }
      },
    })
  }

  // ponytail: this exists. Replaces the older in-place replace path that overwrote the original bytes; originals are now immutable and derivatives live as separate FileRecord rows.
  private async registerDerivative(
    assetId: string,
    userId: string,
    outPath: string,
    sig?: string,
  ): Promise<string> {
    const bytes = await readFile(outPath)
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const fileId = randomUUID()
    const storageKey = this.storage.buildKey('transcode', userId, fileId, 'webm')
    await this.storage.save(storageKey, outPath)

    const saved = await this.core.registerFile(
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
    if (saved.id !== fileId) await this.storage.delete(storageKey).catch(() => undefined)
    return saved.id
  }
}
