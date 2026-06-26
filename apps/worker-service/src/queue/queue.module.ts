import { Module, OnModuleInit } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { BullMqService } from './bullmq.service'
import { ThumbnailProcessor } from './thumbnail.processor'
import { VideoProcessor } from './video.processor'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'
import { HlsHttpClient } from '../storage/hls-http.client'

@Module({
  imports: [HttpModule],
  providers: [
    BullMqService,
    ThumbnailProcessor,
    VideoProcessor,
    MetadataExtractor,
    VideoMetadataExtractor,
    HlsHttpClient,
  ],
  exports: [BullMqService],
})
export class QueueModule implements OnModuleInit {
  constructor(
    private readonly thumbnailProcessor: ThumbnailProcessor,
    private readonly videoProcessor: VideoProcessor,
  ) {}

  onModuleInit() {
    this.thumbnailProcessor.start()
    this.videoProcessor.start()
  }
}
