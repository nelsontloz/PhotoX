import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset, UploadSession, UploadSessionPart } from '../database/entities'
import { StorageModule } from '../files/storage/storage.module'
import { UserFilesModule } from '../files/user/user-files.module'
import { AssetsModule } from '../assets/assets.module'
import { UploadsService } from './uploads.service'
import { UploadsController } from './uploads.controller'
import { UploadSessionsSweeper } from './upload-sessions.sweeper'

@Module({
  imports: [
    TypeOrmModule.forFeature([UploadSession, UploadSessionPart, Asset]),
    StorageModule,
    UserFilesModule,
    AssetsModule,
  ],
  controllers: [UploadsController],
  providers: [UploadsService, UploadSessionsSweeper],
  exports: [UploadsService],
})
export class UploadsModule {}
