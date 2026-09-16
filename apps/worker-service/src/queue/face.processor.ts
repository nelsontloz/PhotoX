import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { copyFile, unlink } from 'fs/promises'
import { BullMqService } from './bullmq.service'
import { FaceDetectorService } from './face.detector'
import { Asset, Face, FileRecord, LocalStorageService } from '@photox/data-access'

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
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(Face)
    private readonly faceRepo: Repository<Face>,
    private readonly storage: LocalStorageService,
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

    const filePath = join(tmpdir(), `face-${randomUUID()}`)
    try {
      await this.assetRepo.update(assetId, { faceStatus: 'pending' })

      const record = await this.fileRepo.findOne({ where: { id: fileId } })
      if (!record) throw new Error(`File not found: ${fileId}`)
      await copyFile(this.storage.pathFor(record.storageKey), filePath)

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

      if (faces.length > 0) {
        await this.faceRepo.save(
          faces.map((f) =>
            this.faceRepo.create({
              assetId,
              userId,
              box: f.box,
              confidence: f.confidence,
              embedding: f.embedding,
              personId: null,
            }),
          ),
        )
      }

      await this.assetRepo.update(assetId, {
        faceStatus: 'ready',
        faceCount: faces.length,
      })

      this.logger.log(`Faces complete: asset=${assetId}, count=${faces.length}`)

      try {
        await this.bullMq.getQueue('process-faces-cluster').add(
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
        await this.assetRepo.update(assetId, { faceStatus: 'failed' })
      } catch (patchErr) {
        const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        this.logger.warn(`Failed to patch face status to failed for asset=${assetId}: ${patchMsg}`)
      }

      throw err
    } finally {
      await unlink(filePath).catch(() => undefined)
    }
  }
}
