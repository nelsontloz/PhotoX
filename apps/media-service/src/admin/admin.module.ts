import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../entities/asset.entity'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AdminAssetsController } from './admin-assets.controller'
import { AdminAssetsService } from './admin-assets.service'

@Module({
  imports: [TypeOrmModule.forFeature([Asset])],
  controllers: [AdminController, AdminAssetsController],
  providers: [AdminService, AdminAssetsService],
})
export class AdminModule {}
