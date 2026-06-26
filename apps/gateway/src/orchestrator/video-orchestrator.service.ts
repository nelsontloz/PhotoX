import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'
import { sleep } from '../common/sleep'

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [500, 1000, 2000]

interface VideoJob {
  assetId: string
  fileId: string
  userId: string
}

@Injectable()
export class VideoOrchestratorService {
  private readonly logger = new Logger(VideoOrchestratorService.name)

  constructor(private readonly http: HttpService) {}

  async enqueueVideo(assetId: string, fileId: string, userId: string): Promise<void> {
    await this.tryEnqueue({ assetId, fileId, userId })
  }

  private async tryEnqueue(job: VideoJob): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await firstValueFrom(
          this.http.post(
            `${SERVICE_URLS['worker-service']}/v1/jobs/video`,
            {
              assetId: job.assetId,
              fileId: job.fileId,
              userId: job.userId,
            },
            { timeout: 5_000 },
          ),
        )
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (attempt < MAX_ATTEMPTS - 1) {
          const delay = BACKOFF_MS[attempt] ?? 1000
          await sleep(delay)
        } else {
          this.logger.error(
            `Failed to enqueue video after ${MAX_ATTEMPTS} attempts (asset=${job.assetId}): ${msg}`,
          )
        }
      }
    }
    return false
  }
}
