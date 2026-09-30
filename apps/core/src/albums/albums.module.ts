import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Album } from './entities/album.entity'
import { AlbumAsset } from './entities/album-asset.entity'
import { Asset } from '../database/entities'
import { AlbumsService } from './albums.service'
import { AlbumsController } from './albums.controller'
import { AssetsModule } from '../assets/assets.module'

@Module({
  imports: [TypeOrmModule.forFeature([Album, AlbumAsset, Asset]), AssetsModule],
  controllers: [AlbumsController],
  providers: [AlbumsService],
  exports: [AlbumsService],
})
export class AlbumsModule {}
