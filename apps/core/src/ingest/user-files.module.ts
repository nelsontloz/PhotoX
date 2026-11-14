import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileRecord } from '../database/entities';
import { StorageModule } from '../storage/storage.module';
import { AssetsModule } from '../assets/assets.module';
import { UserFilesService } from './user-files.service';
import { UserFilesController } from './user-files.controller';
import { AssetContentController } from './asset-content.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord]), StorageModule, AssetsModule],
  providers: [UserFilesService],
  controllers: [UserFilesController, AssetContentController],
  exports: [UserFilesService],
})
export class UserFilesModule {}
