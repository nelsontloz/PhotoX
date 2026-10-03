import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Share } from './entities/share.entity'
import { Asset } from '../database/entities'
import { Album } from '../albums/entities/album.entity'
import { AlbumAsset } from '../albums/entities/album-asset.entity'
import { UserFilesModule } from '../files/user/user-files.module'
import { SharesService } from './shares.service'
import { SharesController } from './shares.controller'
import { PublicSharesController } from './public-shares.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Share, Asset, Album, AlbumAsset]), UserFilesModule],
  controllers: [SharesController, PublicSharesController],
  providers: [SharesService],
})
export class SharesModule {}
