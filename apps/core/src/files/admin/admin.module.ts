import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { FileRecord } from '@photox/data-access'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord])],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
