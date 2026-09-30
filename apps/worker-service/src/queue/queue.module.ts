import { Module, OnModuleInit } from '@nestjs/common'
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
import { CleanupProcessor } from './cleanup.processor'
import { CleanupOrphansProcessor } from './cleanup-orphans.processor'
import { CoreClient } from '../core/core-client.service'

@Module({
  imports: [
    // ponytail: registerAsync (not register) — defers loadAuthEnv() until app.module's
    // loadRootEnvFile() has loaded root .env; matches apps/core
    JwtModule.registerAsync({
      useFactory: () => ({ secret: loadAuthEnv().AUTH_TOKEN_SECRET }),
    }),
  ],
  providers: [
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
    CleanupProcessor,
    CleanupOrphansProcessor,
  ],
  exports: [BullMqService],
})
export class QueueModule implements OnModuleInit {
  constructor(
    private readonly thumbnailProcessor: ThumbnailProcessor,
    private readonly videoProcessor: VideoProcessor,
    private readonly metadataProcessor: MetadataProcessor,
    private readonly faceProcessor: FaceProcessor,
    private readonly faceClusterService: FaceClusterService,
    private readonly cleanupProcessor: CleanupProcessor,
    private readonly cleanupOrphansProcessor: CleanupOrphansProcessor,
  ) {}

  onModuleInit() {
    this.thumbnailProcessor.start()
    this.videoProcessor.start()
    this.metadataProcessor.start()
    this.faceProcessor.start()
    this.faceClusterService.start()
    this.cleanupProcessor.start()
    this.cleanupOrphansProcessor.start()
  }
}
