import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import sharp from 'sharp'
import { firstValueFrom } from 'rxjs'
import FormData from 'form-data'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { BullMqService } from './bullmq.service'
import { SERVICE_URLS } from '@photox/shared-config'
import { runFfmpeg } from './ffmpeg'

const STANDARD_SIZES: Record<string, [number, number]> = {
  sm: [150, 150],
  md: [300, 300],
  lg: [600, 600],
  xl: [1920, 1920],
}

// ponytail: fit: 'inside' preserves the source aspect ratio (landscape/portrait); 'cover' was cropping to a square, which broke the downstream masonry grid.
const RESIZE_OPTIONS: Record<string, sharp.ResizeOptions> = {
  sm: { fit: 'inside' },
  md: { fit: 'inside' },
  lg: { fit: 'inside' },
  xl: { fit: 'inside' },
}

const WEBP_QUALITY: Record<string, number> = {
  sm: 80,
  md: 80,
  lg: 80,
  xl: 85,
}

interface ThumbnailJob {
  assetId: string
  fileId: string
  size: string
  userId: string
}

@Injectable()
export class ThumbnailProcessor {
  private readonly logger = new Logger(ThumbnailProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly http: HttpService,
  ) {}

  start() {
    this.bullMq.createWorker<ThumbnailJob>('process-thumbnail', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Thumbnail processor listening for jobs')
  }

  private async processJob(job: Job<ThumbnailJob>) {
    const { assetId, fileId, size, userId } = job.data

    this.logger.log(`Processing thumbnail: asset=${assetId}, size=${size}`)

    try {
      await this.generateThumbnail(fileId, assetId, size, userId)

      this.logger.log(`Thumbnail complete: asset=${assetId}, size=${size}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Thumbnail failed: asset=${assetId}, size=${size} — ${message}`)

      try {
        const statusUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
        await firstValueFrom(this.http.patch(statusUrl, { thumbnailStatus: 'failed' }))
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        this.logger.warn(
          `Failed to patch thumbnail status to failed for asset=${assetId}, size=${size}: ${patchMsg}`,
        )
      }

      throw err
    }
  }

  private async generateThumbnail(
    fileId: string,
    assetId: string,
    size: string,
    userId: string,
  ): Promise<void> {
    const dims = STANDARD_SIZES[size]
    const [width, height] = dims ?? size.split('x').map(Number)

    const streamUrl = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/stream`
    const upstream = await firstValueFrom(
      this.http.get(streamUrl, { responseType: 'arraybuffer', timeout: 30_000 }),
    )
    const buffer = Buffer.from(upstream.data as ArrayBuffer)

    const ctHeader = upstream.headers['content-type']
    const rawContentType =
      typeof ctHeader === 'string' ? ctHeader : ((Array.isArray(ctHeader) ? ctHeader[0] : '') ?? '')
    const mimeType = rawContentType.split(';')[0]?.trim() ?? null

    if (mimeType?.startsWith('video/')) {
      let tmpPath: string | null = null
      try {
        const ext = mimeType.includes('mp4')
          ? 'mp4'
          : mimeType.includes('webm')
            ? 'webm'
            : mimeType.includes('quicktime')
              ? 'mov'
              : 'bin'
        tmpPath = join(tmpdir(), `${fileId}-${randomUUID()}.${ext}`)
        await writeFile(tmpPath, buffer)

        let orientation: number | null = null
        let durationSeconds: number | null = null

        // ponytail: 5x1s wait for metadata to land; race is rare
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const assetUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}?userId=${encodeURIComponent(userId)}`
            const assetRes = await firstValueFrom(this.http.get(assetUrl))
            const asset = assetRes.data as {
              orientation?: number | null
              durationSeconds?: number | null
              mimeType?: string | null
            }
            orientation = asset.orientation ?? null
            durationSeconds = asset.durationSeconds ?? null
            break
          } catch {
            if (attempt < 4) {
              await new Promise((r) => setTimeout(r, 1000))
            }
          }
        }
        orientation ??= 1
        if (durationSeconds === null || !Number.isFinite(durationSeconds)) durationSeconds = 0

        const seekSec =
          durationSeconds > 0
            ? Math.min(Math.max(0, durationSeconds * 0.25), Math.max(0, durationSeconds - 0.1))
            : 0

        const frameBuffer = (
          await runFfmpeg([
            '-y',
            '-ss',
            String(seekSec),
            '-i',
            tmpPath,
            '-vframes',
            '1',
            '-f',
            'image2pipe',
            '-',
          ])
        ).stdout

        // ponytail: per-rotation step is image metadata's job now
        let framePipeline = sharp(frameBuffer)
        if (orientation > 1) {
          framePipeline = framePipeline.rotate(orientation)
        }
        const { data: thumbBuffer, info } = await framePipeline
          .resize(width, height, RESIZE_OPTIONS[size] ?? { fit: 'inside' })
          .webp({ quality: WEBP_QUALITY[size] ?? 80 })
          .toBuffer({ resolveWithObject: true })

        const uploadUrl = `${SERVICE_URLS['file-storage-service']}/v1/files`
        const form = new FormData()
        form.append('file', thumbBuffer, {
          filename: `thumb-${size}.webp`,
          contentType: 'image/webp',
        })
        form.append('userId', userId)

        const uploadRes = await firstValueFrom(
          this.http.post(uploadUrl, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          }),
        )
        const newFileRecord = uploadRes.data as { id: string }

        const registerUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/thumbnails`
        await firstValueFrom(
          this.http.post(registerUrl, {
            size,
            fileId: newFileRecord.id,
            width: info.width,
            height: info.height,
            bytes: thumbBuffer.length,
          }),
        )

        try {
          const statusUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
          await firstValueFrom(this.http.patch(statusUrl, { thumbnailStatus: 'ready' }))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.logger.warn(`Thumbnail status update failed for asset=${assetId}: ${msg}`)
        }

        return
      } finally {
        if (tmpPath) {
          try {
            await unlink(tmpPath)
          } catch {
            // file may already be removed
          }
        }
      }
    }

    const { data: thumbBuffer, info } = await sharp(buffer)
      .resize(width, height, RESIZE_OPTIONS[size] ?? { fit: 'inside' })
      .webp({ quality: WEBP_QUALITY[size] ?? 80 })
      .toBuffer({ resolveWithObject: true })

    const uploadUrl = `${SERVICE_URLS['file-storage-service']}/v1/files`
    const form = new FormData()
    form.append('file', thumbBuffer, {
      filename: `thumb-${size}.webp`,
      contentType: 'image/webp',
    })
    form.append('userId', userId)

    const uploadRes = await firstValueFrom(
      this.http.post(uploadUrl, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }),
    )
    const newFileRecord = uploadRes.data as { id: string }

    const registerUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/thumbnails`
    await firstValueFrom(
      this.http.post(registerUrl, {
        size,
        fileId: newFileRecord.id,
        width: info.width,
        height: info.height,
        bytes: thumbBuffer.length,
      }),
    )

    try {
      const statusUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
      await firstValueFrom(this.http.patch(statusUrl, { thumbnailStatus: 'ready' }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Thumbnail status update failed for asset=${assetId}: ${msg}`)
    }
  }
}
