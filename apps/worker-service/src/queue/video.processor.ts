import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { copyFile, rm, mkdir, readFile } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { Asset, FileRecord, LocalStorageService } from '@photox/data-access'
import { runFfmpeg, runFfprobeJson } from './ffmpeg'

interface ProcessVideoJob {
  assetId: string
  fileId: string
  userId: string
}

const MAX_DURATION_SEC = 4 * 60 * 60
const MAX_DIMENSION = 7680
const TRANSCODE_TIMEOUT_MS = 60 * 60 * 1000

@Injectable()
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly storage: LocalStorageService,
  ) {}

  start() {
    this.bullMq.createWorker<ProcessVideoJob>('process-video', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Video processor listening for jobs')
  }

  private async processJob(job: Job<ProcessVideoJob>) {
    const { assetId, fileId, userId } = job.data

    this.logger.log(`Processing video transcode: asset=${assetId}`)

    const srcDir = join(tmpdir(), fileId)
    const outDir = `${srcDir}-transcode`

    try {
      await this.patchAsset(assetId, { transcodeStatus: 'pending' })

      const srcPath = await this.downloadSource(fileId, userId, srcDir)

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
        await this.patchAsset(assetId, { transcodeStatus: 'ready', transcodeFileId: null })
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
        'libaom-av1',
        '-crf',
        '32',
        '-cpu-used',
        '6',
        '-pix_fmt',
        'yuv420p',
        ...(scaleFilter ? ['-vf', scaleFilter] : []),
        ...(audioStream ? ['-c:a', 'libopus', '-b:a', '96k'] : []),
        outPath,
      ]

      await runFfmpeg(ffmpegArgs, { timeoutMs: TRANSCODE_TIMEOUT_MS })

      const derivativeFileId = await this.registerDerivative(assetId, userId, outPath)

      await this.patchAsset(assetId, {
        transcodeStatus: 'ready',
        transcodeFileId: derivativeFileId,
      })
      this.logger.log(`Video transcode complete: asset=${assetId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Video transcode failed: asset=${assetId} — ${message}`)

      try {
        await this.patchAsset(assetId, {
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

  private async downloadSource(fileId: string, userId: string, destDir: string): Promise<string> {
    const record = await this.fileRepo.findOne({ where: { id: fileId, userId } })
    if (!record) throw new Error(`File not found: ${fileId}`)
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
    const existing = await this.fileRepo.findOne({
      where: { userId, checksumSha256: checksum, purpose: 'transcode', assetId },
    })
    if (existing) return existing.id
    const fileId = randomUUID()
    const storageKey = `${userId}/${fileId}.webm`
    await this.storage.save(storageKey, outPath)
    const saved = await this.fileRepo.save(
      this.fileRepo.create({
        userId,
        storageKey,
        originalName: 'video.webm',
        mimeType: 'video/webm',
        sizeBytes: bytes.length,
        checksumSha256: checksum,
        purpose: 'transcode',
        assetId,
      }),
    )
    return saved.id
  }

  private async patchAsset(assetId: string, patch: Record<string, unknown>): Promise<void> {
    const { status, ...rest } = patch
    await this.assetRepo.update(assetId, {
      ...rest,
      ...(status !== undefined
        ? { metadataStatus: status, metadataExtractedAt: new Date() }
        : {}),
    } as Record<string, unknown>)
  }
}
