import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../entities/asset.entity'
import { AssetThumbnail } from '../entities/asset-thumbnail.entity'
import { InternalController } from './internal.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Asset, AssetThumbnail])],
  controllers: [InternalController],
})
export class InternalModule {}
