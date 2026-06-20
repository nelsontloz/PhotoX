import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { FileRecord } from '../entities/file-record.entity'
import { StorageModule } from '../storage/storage.module'
import { FilesService } from './files.service'
import { FilesController } from './files.controller'
import { InternalFilesController } from './internal-files.controller'

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord]), StorageModule],
  providers: [FilesService],
  controllers: [FilesController, InternalFilesController],
})
export class FilesModule {}
