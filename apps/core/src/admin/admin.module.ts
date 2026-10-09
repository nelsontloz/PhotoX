import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset, AssetThumbnail, FileRecord } from '../database/entities'
import { StorageModule } from '../files/storage/storage.module'
import { SettingsModule } from '../settings/settings.module'
import { AdminAssetsController } from './admin-assets.controller'
import { AdminAssetsService } from './admin-assets.service'
import { AdminFacesController } from './admin-faces.controller'
import { AdminFacesService } from './admin-faces.service'
import { AdminReprocessService } from './admin-reprocess.service'
import { AdminPlacesService } from './admin-places.service'
import { AdminMetadataService } from './admin-metadata.service'
import { AdminMaintenanceController } from './admin-maintenance.controller'
import { PlacesModule } from '../places/places.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset, FileRecord, AssetThumbnail]),
    StorageModule,
    SettingsModule,
    PlacesModule,
  ],
  controllers: [AdminAssetsController, AdminMaintenanceController, AdminFacesController],
  providers: [
    AdminAssetsService,
    AdminFacesService,
    AdminReprocessService,
    AdminPlacesService,
    AdminMetadataService,
  ],
})
export class AdminModule {}
