import { Injectable, Logger } from '@nestjs/common'
import { BullMqService } from '../queue/bullmq.service'

const STANDARD_SIZES = ['sm', 'md', 'lg', 'xl']

interface ThumbnailJob {
  assetId: string
  fileId: string
  userId: string
  size: string
}

@Injectable()
export class ThumbnailOrchestratorService {
  private readonly logger = new Logger(ThumbnailOrchestratorService.name)

  constructor(private readonly bullMq: BullMqService) {}

  async enqueueThumbnails(assetId: string, fileId: string, userId: string): Promise<void> {
    for (const size of STANDARD_SIZES) {
      const job: ThumbnailJob = { assetId, fileId, userId, size }
      try {
        await this.bullMq.getQueue('process-thumbnail').add('process-thumbnail', job, {
          jobId: `thumb:${assetId}:${size}`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Failed to enqueue thumbnail (asset=${assetId}, size=${size}): ${msg}`)
      }
    }
  }
}
