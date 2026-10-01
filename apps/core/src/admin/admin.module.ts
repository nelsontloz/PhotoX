import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset, AssetThumbnail, FileRecord } from '../database/entities'
import { StorageModule } from '../files/storage/storage.module'
import { SettingsModule } from '../settings/settings.module'
import { AdminAssetsController } from './admin-assets.controller'
import { AdminAssetsService } from './admin-assets.service'
import { AdminFacesController } from './admin-faces.controller'
import { AdminMaintenanceController } from './admin-maintenance.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset, FileRecord, AssetThumbnail]),
    StorageModule,
    SettingsModule,
  ],
  controllers: [AdminAssetsController, AdminMaintenanceController, AdminFacesController],
  providers: [AdminAssetsService],
})
export class AdminModule {}
