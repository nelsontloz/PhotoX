import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../entities/asset.entity'
import { AssetThumbnail } from '../entities/asset-thumbnail.entity'
import { AssetsService } from './assets.service'
import { AssetsController } from './assets.controller'
import { ThumbnailsService } from './thumbnails.service'
import { ThumbnailsController } from './thumbnails.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Asset, AssetThumbnail])],
  controllers: [AssetsController, ThumbnailsController],
  providers: [AssetsService, ThumbnailsService],
})
export class AssetsModule {}
