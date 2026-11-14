import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadSession, UploadSessionPart } from '../database/entities';
import { StorageModule } from '../storage/storage.module';
import { UserFilesModule } from '../ingest/user-files.module';
import { AssetsModule } from '../assets/assets.module';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';
import { UploadSessionsSweeper } from './upload-sessions.sweeper';

@Module({
  imports: [
    TypeOrmModule.forFeature([UploadSession, UploadSessionPart]),
    StorageModule,
    UserFilesModule,
    AssetsModule,
  ],
  controllers: [UploadsController],
  providers: [UploadsService, UploadSessionsSweeper],
})
export class UploadsModule {}
