import { Module, OnModuleInit } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HttpModule } from '@nestjs/axios'
import { PgBossService } from './pg-boss.service'
import { ThumbnailProcessor } from './thumbnail.processor'
import { MetadataExtractor } from './metadata.extractor'
import { JobRecord } from './entities/job.entity'
import { QueueController } from './queue.controller'

@Module({
  imports: [TypeOrmModule.forFeature([JobRecord]), HttpModule],
  controllers: [QueueController],
  providers: [PgBossService, ThumbnailProcessor, MetadataExtractor],
  exports: [PgBossService],
})
export class QueueModule implements OnModuleInit {
  constructor(private readonly processor: ThumbnailProcessor) {}

  async onModuleInit() {
    await this.processor.start()
  }
}
