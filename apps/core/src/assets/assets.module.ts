import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../database/entities'
import { AssetThumbnail } from '../database/entities'
import { AssetsService } from './assets.service'
import { AssetsController } from './assets.controller'
import { FacesModule } from '../faces/faces.module'
import { PlacesModule } from '../places/places.module'

@Module({
  imports: [TypeOrmModule.forFeature([Asset, AssetThumbnail]), FacesModule, PlacesModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
