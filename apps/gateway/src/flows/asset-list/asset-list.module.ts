import { Module } from '@nestjs/common'
import { ProxyModule } from '../../proxy/proxy.module'
import { AssetListController } from './asset-list.controller'
import { AssetListOrchestrator } from './asset-list.orchestrator'

@Module({
  imports: [ProxyModule],
  controllers: [AssetListController],
  providers: [AssetListOrchestrator],
})
export class AssetListFlowModule {}
