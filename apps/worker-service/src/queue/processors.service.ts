import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { LocalStorageService } from '@photox/shared-config'
import { BullMqService } from './bullmq.service'
import { CoreClient } from '../core/core-client.service'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'
import { FaceDetectorService } from './face.detector'
import { EmbeddingService } from './embedding.service'
import { DetectService } from './detect.service'
import { FaceClusterService, faceClusterProcessor } from './face.cluster'
import { thumbnailProcessor } from './thumbnail.processor'
import { videoProcessor } from './video.processor'
import { metadataProcessor } from './metadata.processor'
import { faceProcessor } from './face.processor'
import { embeddingProcessor } from './embed.processor'
import { detectProcessor } from './detect.processor'
import { userDeleteProcessor } from './user-delete.processor'
import type { ProcessorDeps, ProcessorSpec } from './processor-spec'

// every queue consumer, in the order the old per-processor OnModuleInit hooks ran
export const PROCESSORS: readonly ((deps: ProcessorDeps) => ProcessorSpec)[] = [
  thumbnailProcessor,
  videoProcessor,
  metadataProcessor,
  faceProcessor,
  faceClusterProcessor,
  embeddingProcessor,
  detectProcessor,
  userDeleteProcessor,
]

/**
 * The worker's single queue bootstrap: awaits the Redis connection, then registers every
 * consumer in PROCESSORS. One loop keeps a single queue's failure from aborting the rest.
 */
@Injectable()
export class ProcessorsService implements OnModuleInit {
  private readonly logger = new Logger(ProcessorsService.name)
  private readonly deps: ProcessorDeps

  constructor(
    bullMq: BullMqService,
    core: CoreClient,
    storage: LocalStorageService,
    metadataExtractor: MetadataExtractor,
    videoMetadataExtractor: VideoMetadataExtractor,
    faceDetector: FaceDetectorService,
    embedder: EmbeddingService,
    detect: DetectService,
    faceCluster: FaceClusterService,
  ) {
    this.deps = {
      bullMq,
      core,
      storage,
      metadataExtractor,
      videoMetadataExtractor,
      faceDetector,
      embedder,
      detect,
      faceCluster,
    }
  }

  async onModuleInit() {
    // explicit readiness: no dependence on which provider's OnModuleInit runs first
    await this.deps.bullMq.ready()

    for (const make of PROCESSORS) {
      const spec = make(this.deps)
      // one queue failing to start (e.g. a Redis hiccup) must not take the other seven down
      try {
        this.deps.bullMq.createWorker(spec.queue, spec.run, spec.workerOptions)
        spec.logger.log(spec.listening)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(`Failed to start ${spec.queue} worker: ${message}`)
      }
    }
  }
}
