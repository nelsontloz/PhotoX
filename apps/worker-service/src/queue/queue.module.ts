import { Module, OnModuleInit } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { BullMqService } from './bullmq.service'
import { ThumbnailProcessor } from './thumbnail.processor'
import { VideoProcessor } from './video.processor'
import { MetadataProcessor } from './metadata.processor'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'
import { FaceDetectorService } from './face.detector'
import { FaceProcessor } from './face.processor'

@Module({
  imports: [HttpModule],
  providers: [
    BullMqService,
    ThumbnailProcessor,
    VideoProcessor,
    MetadataProcessor,
    MetadataExtractor,
    VideoMetadataExtractor,
    FaceDetectorService,
    FaceProcessor,
  ],
  exports: [BullMqService],
})
export class QueueModule implements OnModuleInit {
  constructor(
    private readonly thumbnailProcessor: ThumbnailProcessor,
    private readonly videoProcessor: VideoProcessor,
    private readonly metadataProcessor: MetadataProcessor,
    private readonly faceProcessor: FaceProcessor,
  ) {}

  onModuleInit() {
    this.thumbnailProcessor.start()
    this.videoProcessor.start()
    this.metadataProcessor.start()
    this.faceProcessor.start()
  }
}
