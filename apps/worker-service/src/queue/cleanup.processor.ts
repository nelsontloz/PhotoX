import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { SERVICE_URLS } from '@photox/shared-config'

interface CleanupJob {
  fileId: string
}

@Injectable()
export class CleanupProcessor {
  private readonly logger = new Logger(CleanupProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly http: HttpService,
  ) {}

  start() {
    this.bullMq.createWorker<CleanupJob>('cleanup-asset', (job) => this.processJob(job), {
      concurrency: 5,
    })

    this.logger.log('Cleanup processor listening for jobs')
  }

  private async processJob(job: Job<CleanupJob>) {
    const { fileId } = job.data

    this.logger.log(`Cleaning up file: fileId=${fileId}`)

    await firstValueFrom(
      this.http.delete(`${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}`, {
        timeout: 30_000,
      }),
    ).catch((err) => {
      this.logger.warn(
        `Failed to delete file ${fileId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    })

    this.logger.log(`Cleanup complete: fileId=${fileId}`)
  }
}
