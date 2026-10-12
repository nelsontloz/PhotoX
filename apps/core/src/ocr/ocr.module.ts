import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../database/entities'
import { AssetOcr } from '../database/entities/asset-ocr.entity'
import { OcrService } from './ocr.service'

@Module({
  imports: [TypeOrmModule.forFeature([AssetOcr, Asset])],
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
