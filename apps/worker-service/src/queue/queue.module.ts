import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { loadAuthEnv, LocalStorageService } from '@photox/shared-config'
import { BullMqService } from './bullmq.service'
import { ThumbnailProcessor } from './thumbnail.processor'
import { VideoProcessor } from './video.processor'
import { MetadataProcessor } from './metadata.processor'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'
import { FaceDetectorService } from './face.detector'
import { FaceEmbedderService } from './face.embedder'
import { FaceProcessor } from './face.processor'
import { FaceClusterService } from './face.cluster'
import { EmbeddingService } from './embedding.service'
import { EmbeddingProcessor } from './embed.processor'
import { OcrService } from './ocr.service'
import { OcrProcessor } from './ocr.processor'
import { DetectService } from './detect.service'
import { DetectProcessor } from './detect.processor'
import { UserDeleteProcessor } from './user-delete.processor'
import { CoreClient } from '../core/core-client.service'

@Module({
  imports: [
    // ponytail: registerAsync (not register) — defers loadAuthEnv() until app.module's
    // loadRootEnvFile() has loaded root .env; matches apps/core
    JwtModule.registerAsync({
      // the worker signs delegated job JWTs ONLY with the worker secret — core accepts
      // both secrets but gates worker-origin tokens through the act allowlist
      useFactory: () => ({ secret: loadAuthEnv().WORKER_JWT_SECRET }),
    }),
  ],
  providers: [
    // ponytail: processors self-start via their own OnModuleInit, relying on provider
    // insertion order + the DI graph (BullMqService first) for connection readiness —
    // not a documented Nest guarantee; add an explicit whenReady/start ordering if flaky
    BullMqService,
    LocalStorageService,
    CoreClient,
    ThumbnailProcessor,
    VideoProcessor,
    MetadataProcessor,
    MetadataExtractor,
    VideoMetadataExtractor,
    FaceDetectorService,
    FaceEmbedderService,
    FaceProcessor,
    FaceClusterService,
    EmbeddingService,
    EmbeddingProcessor,
    OcrService,
    OcrProcessor,
    DetectService,
    DetectProcessor,
    UserDeleteProcessor,
  ],
  exports: [BullMqService],
})
export class QueueModule {}
