import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../database/entities'
import { AssetDetection } from '../database/entities/asset-detection.entity'
import { DetectionsController } from './detections.controller'
import { DetectionsService } from './detections.service'

@Module({
  imports: [TypeOrmModule.forFeature([AssetDetection, Asset])],
  controllers: [DetectionsController],
  providers: [DetectionsService],
  exports: [DetectionsService],
})
export class DetectionsModule {}
