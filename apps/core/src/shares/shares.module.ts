import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from '../database/entities/share.entity';
import { Asset } from '../database/entities';
import { FileRecord } from '../database/entities';
import { Album } from '../database/entities/album.entity';
import { AlbumAsset } from '../database/entities/album-asset.entity';
import { UserFilesModule } from '../ingest/user-files.module';
import { SharesService } from './shares.service';
import { SharesController } from './shares.controller';
import { PublicSharesController } from './public-shares.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Share, Asset, FileRecord, Album, AlbumAsset]),
    UserFilesModule,
  ],
  controllers: [SharesController, PublicSharesController],
  providers: [SharesService],
})
export class SharesModule {}
