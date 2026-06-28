import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import sharp from 'sharp'
import { firstValueFrom } from 'rxjs'
import type { Job } from 'bullmq'
import { randomUUID } from 'crypto'
import { BullMqService } from './bullmq.service'
import { FaceDetectorService } from './face.detector'
import { SERVICE_URLS } from '@photox/shared-config'

interface FaceJob {
  assetId: string
  fileId: string
  userId: string
}

@Injectable()
export class FaceProcessor {
  private readonly logger = new Logger(FaceProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly http: HttpService,
    private readonly faceDetector: FaceDetectorService,
  ) {}

  start() {
    this.bullMq.createWorker<FaceJob>('process-faces', (job) => this.processJob(job), {
      concurrency: 1,
    })

    this.logger.log('Face processor listening for jobs')
  }

  private async processJob(job: Job<FaceJob>) {
    const { assetId, fileId, userId } = job.data

    this.logger.log(`Processing faces: asset=${assetId}`)

    try {
      const patchUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
      await firstValueFrom(this.http.patch(patchUrl, { faceStatus: 'pending' }))

      const streamUrl = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/stream`
      const upstream = await firstValueFrom(
        this.http.get(streamUrl, { responseType: 'arraybuffer', timeout: 30_000 }),
      )
      const buffer = Buffer.from(upstream.data as ArrayBuffer)

      const metadata = await sharp(buffer).metadata()
      if (!metadata.width || !metadata.height) {
        throw new Error('Could not read image dimensions')
      }
      const origW = metadata.width
      const origH = metadata.height

      const resized = await sharp(buffer)
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .toBuffer()
      const resizedMeta = await sharp(resized).metadata()
      const resizedW = resizedMeta.width ?? origW
      const resizedH = resizedMeta.height ?? origH

      const scaleX = origW / resizedW
      const scaleY = origH / resizedH

      const detections = await this.faceDetector.detect(resized)
      const faces = detections.map((d) => ({
        id: randomUUID(),
        box: {
          x: Math.round(d.box.x * scaleX),
          y: Math.round(d.box.y * scaleY),
          w: Math.round(d.box.w * scaleX),
          h: Math.round(d.box.h * scaleY),
        },
        confidence: Math.round(d.confidence * 10000) / 10000,
      }))

      let existingMetadata: Record<string, unknown> = {}
      try {
        const assetUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}?userId=${encodeURIComponent(userId)}`
        const assetRes = await firstValueFrom(this.http.get(assetUrl, { timeout: 5_000 }))
        const asset = assetRes.data as { metadata?: Record<string, unknown> }
        existingMetadata = asset.metadata ?? {}
      } catch {
        // ponytail: metadata may not exist yet; default to empty
      }

      await firstValueFrom(
        this.http.patch(patchUrl, {
          faceStatus: 'ready',
          faceCount: faces.length,
          metadata: { ...existingMetadata, faces },
        }),
      )

      this.logger.log(`Faces complete: asset=${assetId}, count=${faces.length}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Faces failed: asset=${assetId} — ${message}`)

      try {
        const statusUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/metadata`
        await firstValueFrom(this.http.patch(statusUrl, { faceStatus: 'failed' }))
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        this.logger.warn(`Failed to patch face status to failed for asset=${assetId}: ${patchMsg}`)
      }

      throw err
    }
  }
}
