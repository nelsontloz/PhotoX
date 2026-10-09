import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import type { Job } from 'bullmq'
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { BullMqService } from './bullmq.service'
import { embeddingJobSchema, type EmbeddingJob } from './job-schemas'
import { runAssetFileJob } from './asset-file-job'
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
    await runAssetFileJob({ core: this.core, storage: this.storage, logger: this.logger }, job, {
      queue: 'process-embeddings',
      schema: embeddingJobSchema,
      label: 'Embedding',
      missingModelMarkers: ['Vision embedding model not found'],
      onFailure: ({ userId, assetId }) => this.markFailed(userId, assetId),
      body: async ({ data, filePath }) => {
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
        await this.core.registerEmbedding(data.userId, data.assetId, {
          kind: 'image',
          model: SEARCH_EMBEDDING_MODEL,
          embedding,
        })

        this.logger.log(`Embedding complete: asset=${data.assetId}`)
      },
    })
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
