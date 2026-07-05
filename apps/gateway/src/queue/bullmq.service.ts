import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import Redis from 'ioredis'

@Injectable()
export class BullMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqService.name)
  private connection!: Redis
  private readonly queues = new Map<string, Queue>()

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.connection = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      maxRetriesPerRequest: null,
    })
  }

  getQueue(name: string): Queue {
    let queue = this.queues.get(name)
    if (!queue) {
      queue = new Queue(name, { connection: this.connection })
      this.queues.set(name, queue)
    }
    return queue
  }

  async enqueue(
    queueName: string,
    jobName: string,
    data: Record<string, unknown>,
    opts: { jobId?: string; attempts?: number; backoff?: { type: string } } = {},
  ): Promise<void> {
    try {
      await this.getQueue(queueName).add(jobName, data, opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to enqueue ${queueName} job: ${msg}`)
    }
  }

  enqueueThumbnails(assetId: string, fileId: string, userId: string, prefix = 'thumb'): void {
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      void this.enqueue(
        'process-thumbnail',
        'process-thumbnail',
        { assetId, fileId, userId, size },
        {
          jobId: `${prefix}-${assetId}-${size}`,
        },
      )
    }
  }

  enqueueVideo(
    assetId: string,
    fileId: string,
    userId: string,
    opts?: { reprocess?: boolean },
  ): void {
    void this.enqueue(
      'process-video',
      'process-video',
      { assetId, fileId, userId },
      {
        jobId: `${opts?.reprocess ? 'video-reprocess' : 'video'}-${assetId}`,
        attempts: 3,
        backoff: { type: 'exponential' },
      },
    )
  }

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close()
    }
    await this.connection.quit()
  }
}
