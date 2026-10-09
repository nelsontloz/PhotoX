import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { copyFile, rm, mkdir, readFile } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, videoJobSchema, type VideoJob } from './job-schemas'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'
import type { FileRecord } from '@photox/shared-types'
import { runFfmpeg, runFfprobeJson } from './ffmpeg'

const MAX_DURATION_SEC = 4 * 60 * 60
const MAX_DIMENSION = 7680
const TRANSCODE_TIMEOUT_MS = 60 * 60 * 1000

@Injectable()
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
  ) {}

  start() {
    this.bullMq.createWorker<VideoJob>('process-video', (job) => this.processJob(job))

    this.logger.log('Video processor listening for jobs')
  }

  private async processJob(job: Job<VideoJob>) {
    const { assetId, fileId, userId } = parseJobData(videoJobSchema, job.data, 'process-video')

    this.logger.log(`Processing video transcode: asset=${assetId}`)

    const srcDir = join(tmpdir(), fileId)
    const outDir = `${srcDir}-transcode`

    const record = await this.core.getFile(userId, fileId)
    const asset = await this.core.getAsset(userId, assetId)
    assertOwnership({ assetId, fileId, userId }, { record, asset })

    try {
      await this.core.patchMetadata(userId, assetId, { transcodeStatus: 'pending' })

      const srcPath = await this.downloadSource(record, srcDir)

      const probe = await runFfprobeJson(srcPath)
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
        await this.core.patchMetadata(userId, assetId, {
          transcodeStatus: 'ready',
          transcodeFileId: null,
        })
        this.logger.log(`Video already browser-safe, skipping transcode: asset=${assetId}`)
        return
      }

      await mkdir(outDir, { recursive: true })
      const outPath = join(outDir, 'output.webm')

      const scaleFilter = height > 720 ? `scale=-2:min(720\\,ih)` : undefined

      const ffmpegArgs = [
        '-y',
        '-i',
        srcPath,
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

      const derivativeFileId = await this.registerDerivative(assetId, userId, outPath)

      await this.core.patchMetadata(userId, assetId, {
        transcodeStatus: 'ready',
        transcodeFileId: derivativeFileId,
      })
      this.logger.log(`Video transcode complete: asset=${assetId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Video transcode failed: asset=${assetId} — ${message}`)

      try {
        await this.core.patchMetadata(userId, assetId, {
          transcodeStatus: 'failed',
          metadata: { transcodeError: message },
        })
      } catch {
        this.logger.warn(`Failed to patch transcode error for asset=${assetId}`)
      }

      throw err
    } finally {
      try {
        await rm(srcDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
      try {
        await rm(outDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private async downloadSource(record: FileRecord, destDir: string): Promise<string> {
    const ext = record.mimeType.includes('webm')
      ? 'webm'
      : record.mimeType.includes('quicktime')
        ? 'mov'
        : 'mp4'
    await mkdir(destDir, { recursive: true })
    const destPath = join(destDir, `${randomUUID()}.${ext}`)
    await copyFile(this.storage.pathFor(record.storageKey), destPath)
    return destPath
  }

  // ponytail: this exists. Replaces the older in-place replace path that overwrote the original bytes; originals are now immutable and derivatives live as separate FileRecord rows.
  private async registerDerivative(
    assetId: string,
    userId: string,
    outPath: string,
  ): Promise<string> {
    const bytes = await readFile(outPath)
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const fileId = randomUUID()
    const storageKey = this.storage.buildKey('transcode', userId, fileId, 'webm')
    await this.storage.save(storageKey, outPath)

    const saved = await this.core.registerFile(userId, {
      id: fileId,
      kind: 'transcode',
      ext: 'webm',
      checksumSha256: checksum,
      originalName: 'video.webm',
      mimeType: 'video/webm',
      sizeBytes: bytes.length,
      assetId,
    })
    // ponytail: checksum+assetId dedupe returned an existing derivative — drop our unreferenced copy
    if (saved.id !== fileId) await this.storage.delete(storageKey).catch(() => undefined)
    return saved.id
  }
}
