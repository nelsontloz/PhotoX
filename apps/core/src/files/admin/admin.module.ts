import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { FileRecord } from '../../database/entities'
import { StorageModule } from '../storage/storage.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord]), StorageModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
