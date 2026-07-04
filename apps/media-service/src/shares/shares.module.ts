import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AssetShare } from '../entities/asset-share.entity'
import { Asset } from '../entities/asset.entity'
import { SharesService } from './shares.service'
import { SharesController } from './shares.controller'

@Module({
  imports: [TypeOrmModule.forFeature([AssetShare, Asset])],
  controllers: [SharesController],
  providers: [SharesService],
})
export class SharesModule {}
