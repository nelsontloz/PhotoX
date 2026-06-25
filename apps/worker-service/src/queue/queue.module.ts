import { Module, OnModuleInit } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HttpModule } from '@nestjs/axios'
import { PgBossService } from './pg-boss.service'
import { ThumbnailProcessor } from './thumbnail.processor'
import { VideoProcessor } from './video.processor'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'
import { HlsHttpClient } from '../storage/hls-http.client'
import { JobRecord } from './entities/job.entity'
import { QueueController } from './queue.controller'

@Module({
  imports: [TypeOrmModule.forFeature([JobRecord]), HttpModule],
  controllers: [QueueController],
  providers: [
    PgBossService,
    ThumbnailProcessor,
    VideoProcessor,
    MetadataExtractor,
    VideoMetadataExtractor,
    HlsHttpClient,
  ],
  exports: [PgBossService],
})
export class QueueModule implements OnModuleInit {
  constructor(
    private readonly thumbnailProcessor: ThumbnailProcessor,
    private readonly videoProcessor: VideoProcessor,
  ) {}

  async onModuleInit() {
    await this.thumbnailProcessor.start()
    await this.videoProcessor.start()
  }
}
