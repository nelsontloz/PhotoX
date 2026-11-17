import type { Job, WorkerOptions } from 'bullmq';
import type { LocalStorageService } from '@photox/shared-config';
import type { BullMqService } from './bullmq.service';
import type { CoreClient } from '../core/core-client.service';
import type { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor';
import type { FaceDetectorService } from './face.detector';
import type { EmbeddingService } from './embedding.service';
import type { DetectService } from './detect.service';
import type { FaceClusterService } from './face.cluster';
import type { AssetFileJobData, AssetFileJobSpec } from './asset-file-job';

export interface ProcessorDeps {
  bullMq: BullMqService;
  core: CoreClient;
  storage: LocalStorageService;
  metadataExtractor: MetadataExtractor;
  videoMetadataExtractor: VideoMetadataExtractor;
  faceDetector: FaceDetectorService;
  embedder: EmbeddingService;
  detect: DetectService;
  faceCluster: FaceClusterService;
}

interface BaseProcessorSpec {
  queue: string;
  workerOptions?: Partial<WorkerOptions>;
}

// a generic consumer (cluster, user-delete) brings its own runner
export interface GenericProcessorSpec<T = never> extends BaseProcessorSpec {
  run: (job: Job<T>) => Promise<void>;
}

// a media consumer declares the runAssetFileJob spec instead: the init loop adds the queue name
// and a logger named after `label`, so neither is repeated per processor
export interface MediaProcessorSpec<
  T extends AssetFileJobData = AssetFileJobData,
> extends BaseProcessorSpec {
  job: Omit<AssetFileJobSpec<T>, 'queue'>;
}

// one queue consumer's wiring: what ProcessorsService's init loop registers
export type ProcessorSpec<T = never> = GenericProcessorSpec<T> | MediaProcessorSpec;
