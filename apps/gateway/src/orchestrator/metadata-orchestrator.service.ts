import { Injectable, Logger } from '@nestjs/common'
import { BullMqService } from '../queue/bullmq.service'

interface MetadataJob {
  assetId: string
  fileId: string
  userId: string
  kind: 'photo' | 'video'
}

@Injectable()
export class MetadataOrchestratorService {
  private readonly logger = new Logger(MetadataOrchestratorService.name)

  constructor(private readonly bullMq: BullMqService) {}

  async enqueueMetadata(
    assetId: string,
    fileId: string,
    userId: string,
    kind: 'photo' | 'video',
  ): Promise<void> {
    const job: MetadataJob = { assetId, fileId, userId, kind }
    try {
      await this.bullMq.getQueue('process-metadata').add('process-metadata', job, {
        jobId: assetId,
        attempts: 3,
        backoff: { type: 'exponential' },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to enqueue metadata (asset=${assetId}): ${msg}`)
    }
  }
}
