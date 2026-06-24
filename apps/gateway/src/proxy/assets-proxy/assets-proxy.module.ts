import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { OrchestratorModule } from '../../orchestrator/orchestrator.module'
import { AssetsProxyController } from './assets-proxy.controller'

@Module({
  imports: [ProxyModule, OrchestratorModule],
  controllers: [AssetsProxyController],
})
export class AssetsProxyModule {}
