import { Module, OnModuleInit } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HttpModule } from '@nestjs/axios'
import { PgBossService } from './pg-boss.service'
import { ThumbnailProcessor } from './thumbnail.processor'
import { VideoProcessor } from './video.processor'
import { MetadataExtractor, VideoMetadataExtractor } from './metadata.extractor'
import { HlsStorageService } from '../storage/hls-storage.service'
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
    HlsStorageService,
  ],
  exports: [PgBossService],
})
export class QueueModule implements OnModuleInit {
  constructor(
    private readonly thumbnailProcessor: ThumbnailProcessor,
    private readonly videoProcessor: VideoProcessor,
    private readonly hlsStorage: HlsStorageService,
  ) {}

  async onModuleInit() {
    await this.hlsStorage.onModuleInit()
    await this.thumbnailProcessor.start()
    await this.videoProcessor.start()
  }
}
