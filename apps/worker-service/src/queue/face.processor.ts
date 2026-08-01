import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import sharp from 'sharp'
import { firstValueFrom } from 'rxjs'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { unlink } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { FaceDetectorService } from './face.detector'
import { SERVICE_URLS } from '@photox/shared-config'
import { downloadToTemp } from './download'

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
      const { path: filePath } = await downloadToTemp(this.http, streamUrl, tmpdir())

      try {
        const metadata = await sharp(filePath).metadata()
        if (!metadata.width || !metadata.height) {
          throw new Error('Could not read image dimensions')
        }
        const origW = metadata.width
        const origH = metadata.height

        const resized = await sharp(filePath)
          .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
          .toBuffer()
        const resizedMeta = await sharp(resized).metadata()
        const resizedW = resizedMeta.width ?? origW
        const resizedH = resizedMeta.height ?? origH

        const scaleX = origW / resizedW
        const scaleY = origH / resizedH

        const detections = await this.faceDetector.detect(resized)
        const faces = detections.map((d) => ({
          box: {
            x: Math.round(d.box.x * scaleX),
            y: Math.round(d.box.y * scaleY),
            w: Math.round(d.box.w * scaleX),
            h: Math.round(d.box.h * scaleY),
          },
          confidence: Math.round(d.confidence * 10000) / 10000,
          embedding: d.embedding,
        }))

        const facesUrl = `${SERVICE_URLS['media-service']}/v1/assets/${assetId}/faces`
        await firstValueFrom(this.http.post(facesUrl, { userId, faces }, { timeout: 30_000 }))

        await firstValueFrom(
          this.http.patch(patchUrl, {
            faceStatus: 'ready',
            faceCount: faces.length,
          }),
        )

        this.logger.log(`Faces complete: asset=${assetId}, count=${faces.length}`)
      } finally {
        try {
          await unlink(filePath)
        } catch {
          // file may already be removed
        }
      }

      try {
        await this.bullMq
          .getQueue('process-faces-cluster')
          .add(
            'cluster',
            { userId, reason: 'face-detected' },
            {
              jobId: `cluster-${userId}`,
              removeOnFail: true,
              attempts: 3,
              backoff: { type: 'exponential' },
            },
          )
      } catch (clusterErr) {
        const clusterMsg = clusterErr instanceof Error ? clusterErr.message : String(clusterErr)
        this.logger.warn(`Failed to enqueue cluster job for user=${userId}: ${clusterMsg}`)
      }
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
