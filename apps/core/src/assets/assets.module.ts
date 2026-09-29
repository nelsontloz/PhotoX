import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '@photox/data-access'
import { AssetThumbnail } from '@photox/data-access'
import { AssetsService } from './assets.service'
import { AssetsController } from './assets.controller'
import { FacesModule } from '../faces/faces.module'

@Module({
  imports: [TypeOrmModule.forFeature([Asset, AssetThumbnail]), FacesModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
