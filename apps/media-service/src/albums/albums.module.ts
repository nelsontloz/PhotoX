import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Album } from '../entities/album.entity'
import { AlbumAsset } from '../entities/album-asset.entity'
import { Asset } from '../entities/asset.entity'
import { AlbumsService } from './albums.service'
import { AlbumsController } from './albums.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Album, AlbumAsset, Asset])],
  controllers: [AlbumsController],
  providers: [AlbumsService],
  exports: [AlbumsService],
})
export class AlbumsModule {}
