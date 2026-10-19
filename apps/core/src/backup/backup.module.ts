import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset, FileRecord, Person } from '../database/entities'
import { Album } from '../albums/entities/album.entity'
import { AlbumAsset } from '../albums/entities/album-asset.entity'
import { Share } from '../shares/entities/share.entity'
import { User } from '../users/entities/user.entity'
import { StorageModule } from '../files/storage/storage.module'
import { SettingsModule } from '../settings/settings.module'
import { PlacesModule } from '../places/places.module'
import { BackupController } from './backup.controller'
import { BackupMerge } from './entities/backup-merge.entity'
import { S3BackupService } from './s3-backup.service'
import { UserBackupService } from './user-backup.service'

// ponytail: BullMqService is @Global, so no QueueModule import — like AdminModule,
// this module only declares the TypeORM scope its own queries touch
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      FileRecord,
      Asset,
      Album,
      AlbumAsset,
      Share,
      Person,
      BackupMerge,
    ]),
    StorageModule,
    SettingsModule,
    PlacesModule,
  ],
  controllers: [BackupController],
  providers: [S3BackupService, UserBackupService],
})
export class BackupModule {}
