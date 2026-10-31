import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadAuthEnv, LocalStorageService } from '@photox/shared-config';
import { BullMqService } from './bullmq.service';
import { ProcessorsService } from './processors.service';
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor';
import { FaceDetectorService } from './face.detector';
import { FaceEmbedderService } from './face.embedder';
import { FaceClusterService } from './face.cluster';
import { EmbeddingService } from './embedding.service';
import { DetectService } from './detect.service';
import { CoreClient } from '../core/core-client.service';

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
    // every queue worker starts from ProcessorsService's single OnModuleInit loop, which first
    // awaits BullMqService.ready() — no reliance on provider insertion order for readiness
    BullMqService,
    LocalStorageService,
    CoreClient,
    ProcessorsService,
    MetadataExtractor,
    VideoMetadataExtractor,
    FaceDetectorService,
    FaceEmbedderService,
    FaceClusterService,
    EmbeddingService,
    DetectService,
  ],
  exports: [BullMqService],
})
export class QueueModule {}
