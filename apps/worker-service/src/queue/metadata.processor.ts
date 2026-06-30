import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import type { Job } from 'bullmq'
import { writeFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { BullMqService } from './bullmq.service'
import { SERVICE_URLS } from '@photox/shared-config'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'

interface MetadataJob {
  assetId: string
  fileId: string
  userId: string
  kind: 'photo' | 'video'
}

@Injectable()
export class MetadataProcessor {
  private readonly logger = new Logger(MetadataProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly http: HttpService,
    private readonly metadataExtractor: MetadataExtractor,
    private readonly videoMetadataExtractor: VideoMetadataExtractor,
  ) {}

  start() {
    this.bullMq.createWorker<MetadataJob>('process-metadata', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Metadata processor listening for jobs')
  }

  private async processJob(job: Job<MetadataJob>) {
    const { assetId, fileId, kind } = job.data

    this.logger.log(`Processing metadata: asset=${assetId}, kind=${kind}`)

    try {
      const streamUrl = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/stream`
      const upstream = await firstValueFrom(
        this.http.get(streamUrl, { responseType: 'arraybuffer', timeout: 30_000 }),
      )
      const buffer = Buffer.from(upstream.data as ArrayBuffer)

      const ctHeader = upstream.headers['content-type']
      const rawContentType =
        typeof ctHeader === 'string'
          ? ctHeader
          : ((Array.isArray(ctHeader) ? ctHeader[0] : '') ?? '')
      const mimeType = rawContentType.split(';')[0]?.trim() ?? null

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

      if (kind === 'photo' || mimeType?.startsWith('image/')) {
        const metadata = this.metadataExtractor.extract(buffer)
        const hasAnyField = Object.values(metadata).some((v) => v !== null)
        const metadataStatus = hasAnyField ? 'ready' : 'failed'

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
            width: metadata.width,
            height: metadata.height,
            metadata: null,
          }),
        )
      } else if (kind === 'video' || mimeType?.startsWith('video/')) {
        const ext = mimeType?.includes('mp4')
          ? 'mp4'
          : mimeType?.includes('webm')
            ? 'webm'
            : mimeType?.includes('quicktime')
              ? 'mov'
              : 'bin'
        const tmpPath = join(tmpdir(), `${fileId}-${randomUUID()}.${ext}`)
        try {
          await writeFile(tmpPath, buffer)

          const videoMeta = await this.videoMetadataExtractor.extract(tmpPath)
          const hasAnyVideoField = (
            [
              videoMeta.durationSeconds,
              videoMeta.width,
              videoMeta.height,
              videoMeta.codec,
              videoMeta.fps,
              videoMeta.hasAudio,
              videoMeta.orientation,
              videoMeta.takenAt,
              videoMeta.cameraMake,
              videoMeta.cameraModel,
              videoMeta.lensModel,
              videoMeta.latitude,
              videoMeta.longitude,
              videoMeta.altitude,
            ]
          ).some((v) => v !== null)
          const videoMetadataStatus = hasAnyVideoField ? 'ready' : 'failed'
          await firstValueFrom(
            this.http.patch(patchUrl, {
              status: videoMetadataStatus,
              mimeType,
              durationSeconds: videoMeta.durationSeconds,
              width: videoMeta.width,
              height: videoMeta.height,
              codec: videoMeta.codec,
              fps: videoMeta.fps,
              hasAudio: videoMeta.hasAudio,
              orientation: videoMeta.orientation,
              sizeBytes,
              originalName,
              takenAt: videoMeta.takenAt,
              cameraMake: videoMeta.cameraMake,
              cameraModel: videoMeta.cameraModel,
              lensModel: videoMeta.lensModel,
              latitude: videoMeta.latitude,
              longitude: videoMeta.longitude,
              altitude: videoMeta.altitude,
              metadata: null,
            }),
          )
        } finally {
          try {
            await unlink(tmpPath)
          } catch {
            // file may already be removed
          }
        }
      }

      this.logger.log(`Metadata complete: asset=${assetId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Metadata failed: asset=${assetId} — ${message}`)

      try {
        const statusUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
        await firstValueFrom(this.http.patch(statusUrl, { status: 'failed' }))
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        this.logger.warn(
          `Failed to patch metadata status to failed for asset=${assetId}: ${patchMsg}`,
        )
      }

      throw err
    }
  }
}
