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
import { BackupStorageIo } from './backup-storage-io';
import { BackupStatusService } from './backup-status.service';
import { BackupPrefixService } from './backup-prefix.service';
import { RunFinalizeService } from './run-finalize.service';
import { TransferDispatchService } from './transfer-dispatch.service';
import { RunLifecycleService } from './run-lifecycle.service';
import { BackupMergeService } from './backup-merge.service';
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
  // The facade delegates to one provider per phase (storage I/O, status, prefix, finalize,
  // dispatch, lifecycle, merge) — Nest builds them from the TypeORM scope above.
  providers: [
    S3BackupService,
    BackupStorageIo,
    BackupStatusService,
    BackupPrefixService,
    RunFinalizeService,
    TransferDispatchService,
    RunLifecycleService,
    BackupMergeService,
    UserBackupService,
    BackupTransfersDispatcher,
    BackupTransferConsumers,
  ],
  exports: [UserBackupService],
})
export class BackupModule {}
