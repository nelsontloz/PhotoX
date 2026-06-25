import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [500, 1000, 2000]
const DLQ_RETRY_INTERVAL_MS = 30_000
const DLQ_MAX_RETRIES = 10

interface VideoJob {
  assetId: string
  fileId: string
  userId: string
}

interface DlqEntry {
  job: VideoJob
  attempts: number
  nextAttemptAt: number
}

@Injectable()
export class VideoOrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(VideoOrchestratorService.name)
  private readonly dlq: DlqEntry[] = []
  private dlqTimer: NodeJS.Timeout | null = null

  constructor(private readonly http: HttpService) {
    this.dlqTimer = setInterval(() => void this.drainDlq(), DLQ_RETRY_INTERVAL_MS)
  }

  onModuleDestroy(): void {
    if (this.dlqTimer) {
      clearInterval(this.dlqTimer)
      this.dlqTimer = null
    }
    if (this.dlq.length > 0) {
      this.logger.error(
        `${this.dlq.length} video job(s) still in DLQ on shutdown — these will be lost`,
      )
    }
  }

  async enqueueVideo(assetId: string, fileId: string, userId: string): Promise<void> {
    const job: VideoJob = { assetId, fileId, userId }
    const ok = await this.tryEnqueue(job)
    if (!ok) {
      this.addToDlq(job)
    }
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

  private addToDlq(job: VideoJob): void {
    this.dlq.push({
      job,
      attempts: 0,
      nextAttemptAt: Date.now() + DLQ_RETRY_INTERVAL_MS,
    })
    this.logger.error(
      `Video job moved to DLQ (asset=${job.assetId}) — will retry every ${DLQ_RETRY_INTERVAL_MS / 1000}s`,
    )
  }

  private async drainDlq(): Promise<void> {
    if (this.dlq.length === 0) return

    const now = Date.now()
    const due = this.dlq.filter((e) => e.nextAttemptAt <= now)
    if (due.length === 0) return

    this.logger.log(`DLQ drain: retrying ${due.length} video job(s)`)

    for (const entry of due) {
      entry.attempts++
      const ok = await this.tryEnqueue(entry.job)
      if (ok) {
        const idx = this.dlq.indexOf(entry)
        if (idx >= 0) this.dlq.splice(idx, 1)
        this.logger.log(
          `DLQ job recovered (asset=${entry.job.assetId}) after ${entry.attempts} DLQ attempt(s)`,
        )
      } else if (entry.attempts >= DLQ_MAX_RETRIES) {
        const idx = this.dlq.indexOf(entry)
        if (idx >= 0) this.dlq.splice(idx, 1)
        this.logger.error(
          `DLQ job permanently failed after ${entry.attempts} retries (asset=${entry.job.assetId}) — manual intervention required`,
        )
      } else {
        entry.nextAttemptAt = Date.now() + DLQ_RETRY_INTERVAL_MS
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
