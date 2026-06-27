import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, rm, mkdir, readFile } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { SERVICE_URLS } from '@photox/shared-config'
import { runFfmpeg, runFfprobeJson } from './ffmpeg'

export interface ProcessVideoJob {
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
    private readonly http: HttpService,
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
        await this.patchAsset(assetId, { transcodeStatus: 'ready' })
        this.logger.log(`Video already browser-safe, skipping transcode: asset=${assetId}`)
        return
      }

      await mkdir(outDir, { recursive: true })
      const outPath = join(outDir, 'output.mp4')

      const scaleFilter = height > 720 ? `scale=-2:min(720\\,ih)` : undefined

      const ffmpegArgs = [
        '-y',
        '-i',
        srcPath,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        ...(scaleFilter ? ['-vf', scaleFilter] : []),
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outPath,
      ]

      await runFfmpeg(ffmpegArgs, { timeoutMs: TRANSCODE_TIMEOUT_MS })

      const transcoded = await readFile(outPath)
      await this.replaceFile(fileId, userId, transcoded)

      await this.patchAsset(assetId, { transcodeStatus: 'ready' })
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
    const urlRes = await firstValueFrom(
      this.http.get<{ url: string }>(
        `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/url?userId=${encodeURIComponent(userId)}&ttl=600`,
        { timeout: 5_000 },
      ),
    )
    const presignedUrl = urlRes.data.url

    const fileRes = await firstValueFrom(
      this.http.get(presignedUrl, {
        responseType: 'arraybuffer',
        timeout: 300_000,
      }),
    )

    const buffer = Buffer.from(fileRes.data as ArrayBuffer)
    const contentType = (fileRes.headers['content-type'] as string) ?? 'video/mp4'
    const ext = contentType.includes('webm')
      ? 'webm'
      : contentType.includes('quicktime')
        ? 'mov'
        : 'mp4'
    const destPath = join(destDir, `source.${ext}`)
    await mkdir(destDir, { recursive: true })
    await writeFile(destPath, buffer)
    return destPath
  }

  private async replaceFile(fileId: string, userId: string, body: Buffer): Promise<void> {
    const form = new FormData()
    form.append('userId', userId)
    const blob = new Blob([body], { type: 'video/mp4' })
    form.append('file', blob, 'video.mp4')
    await firstValueFrom(
      this.http.post(`${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/replace`, form, {
        timeout: 300_000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }),
    )
  }

  private async patchAsset(assetId: string, patch: Record<string, unknown>): Promise<void> {
    const url = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
    await firstValueFrom(this.http.patch(url, patch, { timeout: 5_000 }))
  }
}
