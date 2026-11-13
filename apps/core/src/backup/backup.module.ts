import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset, FileRecord, Person, UserDelete } from '../database/entities';
import { Album } from '../database/entities/album.entity';
import { AlbumAsset } from '../database/entities/album-asset.entity';
import { Share } from '../database/entities/share.entity';
import { User } from '../database/entities/user.entity';
import { StorageModule } from '../storage/storage.module';
import { PlacesModule } from '../places/places.module';
import { BackupController } from './backup.controller';
import { BackupMerge } from '../database/entities/backup-merge.entity';
import { BackupRun } from '../database/entities/backup-run.entity';
import { BackupRunItem } from '../database/entities/backup-run-item.entity';
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
      UserDelete,
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
