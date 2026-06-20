import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { FileRecord } from '../../entities/file-record.entity'
import { StorageModule } from '../../storage/storage.module'
import { UserFilesService } from './user-files.service'
import { UserFilesController } from './user-files.controller'

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord]), StorageModule],
  providers: [UserFilesService],
  controllers: [UserFilesController],
})
export class UserFilesModule {}
