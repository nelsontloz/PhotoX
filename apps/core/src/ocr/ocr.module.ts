import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../database/entities'
import { AssetOcr } from '../database/entities/asset-ocr.entity'
import { OcrController } from './ocr.controller'
import { OcrService } from './ocr.service'

@Module({
  imports: [TypeOrmModule.forFeature([AssetOcr, Asset])],
  controllers: [OcrController],
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
