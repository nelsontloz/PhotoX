import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { Job } from 'bullmq'
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { BullMqService } from './bullmq.service'
import { assetRefsJobSchema, type AssetRefsJob } from './job-schemas'
import { orientedResize, patchStatusFailed, runAssetFileJob } from './asset-file-job'
import { FACE_MAX_DIM } from './face.processor'
import { EmbeddingService } from './embedding.service'
import { CoreClient } from '../core/core-client.service'
import { LocalStorageService } from '@photox/shared-config'

@Injectable()
export class EmbeddingProcessor implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly core: CoreClient,
    private readonly storage: LocalStorageService,
    private readonly embedder: EmbeddingService,
  ) {}

  onModuleInit() {
    this.bullMq.createWorker<AssetRefsJob>('process-embeddings', (job) => this.processJob(job))

    this.logger.log('Embedding processor listening for jobs')
  }

  private async processJob(job: Job<AssetRefsJob>) {
    await runAssetFileJob({ core: this.core, storage: this.storage, logger: this.logger }, job, {
      queue: 'process-embeddings',
      schema: assetRefsJobSchema,
      label: 'Embedding',
      missingModelMarkers: ['Vision embedding model not found'],
      onFailure: ({ userId, assetId }) =>
        patchStatusFailed(this.core, this.logger, userId, assetId, { embeddingStatus: 'failed' }),
      body: async ({ data, filePath }) => {
        // ponytail: same EXIF-oriented ≤2048px prep as face detection — the SigLIP processor
        // downscales to 224 itself; 2048 keeps texture detail without decoding full resolution
        const resized = await orientedResize(filePath, FACE_MAX_DIM)

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
}
