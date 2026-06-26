import { Injectable, Logger } from '@nestjs/common'
import { BullMqService } from '../queue/bullmq.service'

interface VideoJob {
  assetId: string
  fileId: string
  userId: string
}

@Injectable()
export class VideoOrchestratorService {
  private readonly logger = new Logger(VideoOrchestratorService.name)

  constructor(private readonly bullMq: BullMqService) {}

  async enqueueVideo(assetId: string, fileId: string, userId: string): Promise<void> {
    const job: VideoJob = { assetId, fileId, userId }
    try {
      await this.bullMq.getQueue('process-video').add('process-video', job, {
        jobId: `video:${assetId}:v`,
        attempts: 3,
        backoff: { type: 'exponential' },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to enqueue video (asset=${assetId}): ${msg}`)
    }
  }
}
