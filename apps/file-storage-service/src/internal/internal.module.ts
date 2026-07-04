import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { FileRecord } from '../entities/file-record.entity'
import { StorageModule } from '../storage/storage.module'
import { InternalController } from './internal.controller'

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord]), StorageModule],
  controllers: [InternalController],
})
export class InternalModule {}
