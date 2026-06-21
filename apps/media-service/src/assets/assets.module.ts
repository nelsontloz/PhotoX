import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../entities/asset.entity'
import { AssetThumbnail } from '../entities/asset-thumbnail.entity'
import { AssetsService } from './assets.service'
import { AssetsController } from './assets.controller'
import { InternalAssetsController } from './internal-assets.controller'
import { ThumbnailsService } from './thumbnails.service'
import { ThumbnailsController } from './thumbnails.controller'
import { InternalThumbnailsController } from './internal-thumbnails.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Asset, AssetThumbnail])],
  controllers: [
    AssetsController,
    InternalAssetsController,
    ThumbnailsController,
    InternalThumbnailsController,
  ],
  providers: [AssetsService, ThumbnailsService],
})
export class AssetsModule {}
