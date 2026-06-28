import { Injectable, Logger } from '@nestjs/common'
import { BullMqService } from '../queue/bullmq.service'

@Injectable()
export class FaceOrchestratorService {
  private readonly logger = new Logger(FaceOrchestratorService.name)

  constructor(private readonly bullMq: BullMqService) {}

  async enqueueFaces(assetId: string, fileId: string, userId: string): Promise<void> {
    try {
      await this.bullMq.getQueue('process-faces').add(
        'process-faces',
        { assetId, fileId, userId },
        {
          jobId: `face:${assetId}:detect`,
        },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to enqueue faces (asset=${assetId}): ${msg}`)
    }
  }
}
