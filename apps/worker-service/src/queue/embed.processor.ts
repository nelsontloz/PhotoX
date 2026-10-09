import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { copyFile, unlink } from 'fs/promises'
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { BullMqService } from './bullmq.service'
import { assertOwnership, parseJobData, embeddingJobSchema, type EmbeddingJob } from './job-schemas'
import { FACE_MAX_DIM } from './face.processor'
import { EmbeddingService } from './embedding.service'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'

@Injectable()
export class EmbeddingProcessor {
  private readonly logger = new Logger(EmbeddingProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
    private readonly embedder: EmbeddingService,
  ) {}

  start() {
    this.bullMq.createWorker<EmbeddingJob>('process-embeddings', (job) => this.processJob(job))

    this.logger.log('Embedding processor listening for jobs')
  }

  private async processJob(job: Job<EmbeddingJob>) {
    const { assetId, fileId, userId } = parseJobData(
      embeddingJobSchema,
      job.data,
      'process-embeddings',
    )

    this.logger.log(`Processing embedding: asset=${assetId}`)

    const record = await this.core.getFile(userId, fileId)
    const asset = await this.core.getAsset(userId, assetId)
    assertOwnership({ assetId, fileId, userId }, { record, asset })

    const filePath = join(tmpdir(), `embed-${randomUUID()}`)
    try {
      await copyFile(this.storage.pathFor(record.storageKey), filePath)

      // ponytail: same EXIF-oriented ≤2048px prep as face detection — the SigLIP processor
      // downscales to 224 itself; 2048 keeps texture detail without decoding full resolution
      const resized = await sharp(filePath)
        .rotate()
        .resize({
          width: FACE_MAX_DIM,
          height: FACE_MAX_DIM,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer()

      const embedding = await this.embedder.embed(resized)
      await this.core.registerEmbedding(userId, assetId, {
        kind: 'image',
        model: SEARCH_EMBEDDING_MODEL,
        embedding,
      })

      this.logger.log(`Embedding complete: asset=${assetId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // ponytail: missing model weights are provisioning, not a job bug — warn + no retry
      if (message.includes('Vision embedding model not found')) {
        this.logger.warn(`Embedding skipped (missing model): asset=${assetId} — ${message}`)
        await this.markFailed(userId, assetId)
        return
      }
      this.logger.error(`Embedding failed: asset=${assetId} — ${message}`)
      await this.markFailed(userId, assetId)
      throw err
    } finally {
      await unlink(filePath).catch(() => undefined)
    }
  }

  private async markFailed(userId: string, assetId: string): Promise<void> {
    try {
      await this.core.patchMetadata(userId, assetId, { embeddingStatus: 'failed' })
    } catch (patchErr) {
      const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
      this.logger.warn(
        `Failed to patch embedding status to failed for asset=${assetId}: ${patchMsg}`,
      )
    }
  }
}
