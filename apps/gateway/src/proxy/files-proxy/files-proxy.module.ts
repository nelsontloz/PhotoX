import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ProxyModule } from '../proxy.module'
import { OrchestratorModule } from '../../orchestrator/orchestrator.module'
import { FilesProxyController } from './files-proxy.controller'

@Module({
  imports: [HttpModule, ProxyModule, OrchestratorModule],
  controllers: [FilesProxyController],
})
export class FilesProxyModule {}
