import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'

const STANDARD_SIZES = ['sm', 'md', 'lg', 'xl']

@Injectable()
export class ThumbnailOrchestratorService {
  private readonly logger = new Logger(ThumbnailOrchestratorService.name)
  constructor(private readonly http: HttpService) {}

  async enqueueThumbnails(assetId: string, fileId: string, userId: string): Promise<void> {
    for (const size of STANDARD_SIZES) {
      try {
        await firstValueFrom(
          this.http.post(
            `${SERVICE_URLS['worker-service']}/v1/jobs/thumbnail`,
            {
              assetId,
              fileId,
              userId,
              size,
            },
            { timeout: 5000 },
          ),
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.warn(`Failed to enqueue thumbnail job (size=${size}): ${msg}`)
      }
    }
  }
}
