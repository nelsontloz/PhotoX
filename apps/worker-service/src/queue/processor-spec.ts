import type { Logger } from '@nestjs/common'
import type { Job, WorkerOptions } from 'bullmq'
import type { LocalStorageService } from '@photox/shared-config'
import type { BullMqService } from './bullmq.service'
import type { CoreClient } from '../core/core-client.service'
import type { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'
import type { FaceDetectorService } from './face.detector'
import type { EmbeddingService } from './embedding.service'
import type { DetectService } from './detect.service'
import type { FaceClusterService } from './face.cluster'

export interface ProcessorDeps {
  bullMq: BullMqService
  core: CoreClient
  storage: LocalStorageService
  metadataExtractor: MetadataExtractor
  videoMetadataExtractor: VideoMetadataExtractor
  faceDetector: FaceDetectorService
  embedder: EmbeddingService
  detect: DetectService
  faceCluster: FaceClusterService
}

// one queue consumer's wiring: what ProcessorsService's init loop registers
export interface ProcessorSpec<T = never> {
  queue: string
  logger: Logger
  listening: string
  workerOptions?: Partial<WorkerOptions>
  run: (job: Job<T>) => Promise<void>
}
