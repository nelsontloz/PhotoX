import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset, AssetThumbnail, FileRecord } from '@photox/data-access'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AdminAssetsController } from './admin-assets.controller'
import { AdminAssetsService } from './admin-assets.service'
import { AdminMaintenanceController } from './admin-maintenance.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Asset, FileRecord, AssetThumbnail])],
  controllers: [AdminController, AdminAssetsController, AdminMaintenanceController],
  providers: [AdminService, AdminAssetsService],
})
export class AdminModule {}
