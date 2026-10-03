import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../database/entities'
import { AssetEmbedding } from '../database/entities/asset-embedding.entity'
import { AssetsModule } from '../assets/assets.module'
import { GroupsController } from './groups.controller'
import { GroupsService } from './groups.service'

@Module({
  imports: [TypeOrmModule.forFeature([Asset, AssetEmbedding]), AssetsModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
