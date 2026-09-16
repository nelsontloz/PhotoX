import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AssetShare } from './entities/asset-share.entity'
import { Asset } from '@photox/data-access'
import { UserFilesModule } from '../files/user/user-files.module'
import { SharesService } from './shares.service'
import { SharesController } from './shares.controller'
import { PublicSharesController } from './public-shares.controller'

@Module({
  imports: [TypeOrmModule.forFeature([AssetShare, Asset]), UserFilesModule],
  controllers: [SharesController, PublicSharesController],
  providers: [SharesService],
})
export class SharesModule {}
