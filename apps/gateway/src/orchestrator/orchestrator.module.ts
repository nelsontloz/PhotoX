import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ThumbnailOrchestratorService } from './thumbnail-orchestrator.service'
import { VideoOrchestratorService } from './video-orchestrator.service'

@Module({
  imports: [HttpModule],
  providers: [ThumbnailOrchestratorService, VideoOrchestratorService],
  exports: [ThumbnailOrchestratorService, VideoOrchestratorService],
})
export class OrchestratorModule {}
