import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ThumbnailOrchestratorService } from './thumbnail-orchestrator.service'
import { VideoOrchestratorService } from './video-orchestrator.service'
import { MetadataOrchestratorService } from './metadata-orchestrator.service'

@Module({
  imports: [HttpModule],
  providers: [ThumbnailOrchestratorService, VideoOrchestratorService, MetadataOrchestratorService],
  exports: [ThumbnailOrchestratorService, VideoOrchestratorService, MetadataOrchestratorService],
})
export class OrchestratorModule {}
