import { Module, OnModuleInit } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import {
  Asset,
  AssetThumbnail,
  Face,
  FileRecord,
  LocalStorageService,
  Person,
  SharedDatabaseModule,
} from '@photox/data-access'
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

@Module({
  imports: [
    SharedDatabaseModule.forRoot(),
    TypeOrmModule.forFeature([FileRecord, Asset, AssetThumbnail, Face, Person]),
  ],
  providers: [
    BullMqService,
    LocalStorageService,
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
