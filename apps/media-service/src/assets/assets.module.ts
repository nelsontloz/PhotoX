import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../entities/asset.entity'
import { AssetsService } from './assets.service'
import { AssetsController } from './assets.controller'
import { InternalAssetsController } from './internal-assets.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Asset])],
  controllers: [AssetsController, InternalAssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
