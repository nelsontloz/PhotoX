import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ThumbnailOrchestratorService } from './thumbnail-orchestrator.service'

@Module({
  imports: [HttpModule],
  providers: [ThumbnailOrchestratorService],
  exports: [ThumbnailOrchestratorService],
})
export class OrchestratorModule {}
