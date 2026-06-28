import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ThumbnailOrchestratorService } from './thumbnail-orchestrator.service'
import { VideoOrchestratorService } from './video-orchestrator.service'
import { MetadataOrchestratorService } from './metadata-orchestrator.service'
import { FaceOrchestratorService } from './face-orchestrator.service'

@Module({
  imports: [HttpModule],
  providers: [
    ThumbnailOrchestratorService,
    VideoOrchestratorService,
    MetadataOrchestratorService,
    FaceOrchestratorService,
  ],
  exports: [
    ThumbnailOrchestratorService,
    VideoOrchestratorService,
    MetadataOrchestratorService,
    FaceOrchestratorService,
  ],
})
export class OrchestratorModule {}
