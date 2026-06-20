import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../entities/asset.entity'
import { AssetsService } from './assets.service'
import { AssetsController } from './assets.controller'
import { InternalAssetsController } from './internal-assets.controller'
import { FileStorageClient } from './file-storage.client'
import { loadEnv } from '@photox/shared-config'

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Asset])],
  controllers: [AssetsController, InternalAssetsController],
  providers: [
    AssetsService,
    FileStorageClient,
    {
      provide: 'FILE_STORAGE_BASE_URL',
      useFactory: () => loadEnv().FILE_STORAGE_SERVICE_URL,
    },
  ],
})
export class AssetsModule {}
