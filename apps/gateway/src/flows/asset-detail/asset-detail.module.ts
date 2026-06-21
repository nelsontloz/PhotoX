import { Module } from '@nestjs/common'
import { ProxyModule } from '../../proxy/proxy.module'
import { AssetDetailController } from './asset-detail.controller'
import { AssetDetailOrchestrator } from './asset-detail.orchestrator'

@Module({
  imports: [ProxyModule],
  controllers: [AssetDetailController],
  providers: [AssetDetailOrchestrator],
})
export class AssetDetailFlowModule {}
