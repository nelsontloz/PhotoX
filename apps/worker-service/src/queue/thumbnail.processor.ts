import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import sharp from 'sharp'
import { firstValueFrom } from 'rxjs'
import FormData from 'form-data'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, unlink } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { SERVICE_URLS } from '@photox/shared-config'
import {
  MetadataExtractor,
  VideoMetadataExtractor,
  type ExtractedMetadata,
} from './metadata.extractor'
import { runFfmpeg } from './ffmpeg'

const STANDARD_SIZES: Record<string, [number, number]> = {
  sm: [150, 150],
  md: [300, 300],
  lg: [600, 600],
  xl: [1920, 1920],
}

const RESIZE_OPTIONS: Record<string, sharp.ResizeOptions> = {
  sm: { fit: 'cover' },
  md: { fit: 'cover' },
  lg: { fit: 'cover' },
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
    private readonly metadataExtractor: MetadataExtractor,
    private readonly videoMetadataExtractor: VideoMetadataExtractor,
  ) {}

  start() {
    this.bullMq.createWorker<ThumbnailJob>(
      'process-thumbnail',
      (job) => this.processJob(job),
      { concurrency: 1 },
    )

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

    let metadata: ExtractedMetadata = {
      takenAt: null,
      cameraMake: null,
      cameraModel: null,
      lensModel: null,
      orientation: null,
      width: null,
      height: null,
      latitude: null,
      longitude: null,
      altitude: null,
      iso: null,
      fNumber: null,
      exposureTime: null,
      focalLength: null,
      raw: null,
    }
    let metadataStatus: 'ready' | 'failed' | 'pending' = 'pending'

    if (mimeType?.startsWith('image/')) {
      try {
        metadata = this.metadataExtractor.extract(buffer)
        metadataStatus = metadata.raw !== null ? 'ready' : 'failed'
      } catch {
        metadataStatus = 'failed'
      }

      const clHeader = upstream.headers['content-length']
      const rawContentLength =
        typeof clHeader === 'string'
          ? clHeader
          : ((Array.isArray(clHeader) ? clHeader[0] : '') ?? '')
      const sizeBytes = Number(rawContentLength) || buffer.length

      const rawDisposition = String(upstream.headers['content-disposition'] ?? '')
      const nameMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(rawDisposition)
      const originalName = nameMatch ? decodeURIComponent(nameMatch[1]!.trim()) : null

      const patchUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
      try {
        await firstValueFrom(
          this.http.patch(patchUrl, {
            takenAt: metadata.takenAt,
            cameraMake: metadata.cameraMake,
            cameraModel: metadata.cameraModel,
            lensModel: metadata.lensModel,
            orientation: metadata.orientation,
            latitude: metadata.latitude,
            longitude: metadata.longitude,
            iso: metadata.iso,
            fNumber: metadata.fNumber,
            exposureTime: metadata.exposureTime,
            focalLength: metadata.focalLength,
            altitude: metadata.altitude,
            mimeType,
            sizeBytes,
            originalName,
            status: metadataStatus,
          }),
        )
        this.logger.debug(`Metadata patched for asset=${assetId}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.warn(`Metadata patch failed for asset=${assetId}: ${message}`)
      }
    } else if (mimeType?.startsWith('video/')) {
      let tmpPath: string | null = null
      try {
        const ext = mimeType.includes('mp4')
          ? 'mp4'
          : mimeType.includes('webm')
            ? 'webm'
            : mimeType.includes('quicktime')
              ? 'mov'
              : 'bin'
        tmpPath = join(tmpdir(), `${fileId}.${ext}`)
        await writeFile(tmpPath, buffer)

        const videoMeta = await this.videoMetadataExtractor.extract(tmpPath)
        const patchUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
        try {
          await firstValueFrom(
            this.http.patch(patchUrl, {
              status: videoMeta.metadataStatus,
              mimeType,
              durationSeconds: videoMeta.durationSeconds,
              width: videoMeta.width,
              height: videoMeta.height,
              codec: videoMeta.codec,
              fps: videoMeta.fps,
              hasAudio: videoMeta.hasAudio,
              orientation: videoMeta.orientation,
            }),
          )
          this.logger.debug(`Video metadata patched for asset=${assetId}`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.logger.warn(`Video metadata patch failed for asset=${assetId}: ${message}`)
        }

        const seekSec =
          videoMeta.durationSeconds === null ||
          !Number.isFinite(videoMeta.durationSeconds) ||
          videoMeta.durationSeconds <= 0
            ? 1
            : Math.max(1, videoMeta.durationSeconds * 0.25)
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

        const frameOrientation = videoMeta.orientation
        let framePipeline = sharp(frameBuffer)
        if (frameOrientation && frameOrientation > 0) {
          framePipeline = framePipeline.rotate(frameOrientation)
        }
        const { data: thumbBuffer, info } = await framePipeline
          .resize(width, height, RESIZE_OPTIONS[size] ?? { fit: 'cover' })
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
      .resize(width, height, RESIZE_OPTIONS[size] ?? { fit: 'cover' })
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
  }
}
