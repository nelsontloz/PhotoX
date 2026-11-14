import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetDetection } from '../database/entities/asset-detection.entity';
import { DetectionsController } from './detections.controller';
import { AssetsModule } from '../assets/assets.module';
import { DetectionsService } from './detections.service';

@Module({
  imports: [TypeOrmModule.forFeature([AssetDetection]), AssetsModule],
  controllers: [DetectionsController],
  providers: [DetectionsService],
  exports: [DetectionsService],
})
export class DetectionsModule {}
