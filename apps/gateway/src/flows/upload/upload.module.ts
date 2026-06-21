import { Module } from '@nestjs/common'
import { ProxyModule } from '../../proxy/proxy.module'
import { UploadController } from './upload.controller'
import { UploadOrchestrator } from './upload.orchestrator'

@Module({
  imports: [ProxyModule],
  controllers: [UploadController],
  providers: [UploadOrchestrator],
})
export class UploadFlowModule {}
