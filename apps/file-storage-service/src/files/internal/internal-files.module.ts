import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { FileRecord } from '../../entities/file-record.entity'
import { StorageModule } from '../../storage/storage.module'
import { InternalFilesService } from './internal-files.service'
import { InternalFilesController } from './internal-files.controller'

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord]), StorageModule],
  providers: [InternalFilesService],
  controllers: [InternalFilesController],
})
export class InternalFilesModule {}
