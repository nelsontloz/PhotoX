import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset, FileRecord, Person } from '../database/entities';
import { Album } from '../albums/entities/album.entity';
import { AlbumAsset } from '../albums/entities/album-asset.entity';
import { Share } from '../shares/entities/share.entity';
import { User } from '../users/entities/user.entity';
import { StorageModule } from '../files/storage/storage.module';
import { PlacesModule } from '../places/places.module';
import { BackupController } from './backup.controller';
import { BackupMerge } from './entities/backup-merge.entity';
import { BackupRun } from './entities/backup-run.entity';
import { BackupRunItem } from './entities/backup-run-item.entity';
import { S3BackupService } from './s3-backup.service';
import { UserBackupService } from './user-backup.service';
import { BackupTransfersDispatcher } from './backup-transfers.dispatcher';
import { BackupTransferConsumers } from './backup-transfer.consumers';

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
      BackupRun,
      BackupRunItem,
    ]),
    StorageModule,
    PlacesModule,
  ],
  controllers: [BackupController],
  providers: [
    S3BackupService,
    UserBackupService,
    BackupTransfersDispatcher,
    BackupTransferConsumers,
  ],
  exports: [UserBackupService],
})
export class BackupModule {}
