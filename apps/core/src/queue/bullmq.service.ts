import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { loadEnv } from '@photox/shared-config'
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { Queue, type JobsOptions } from 'bullmq'
import Redis from 'ioredis'

@Injectable()
export class BullMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqService.name)
  private connection!: Redis
  private readonly queues = new Map<string, Queue>()

  onModuleInit(): void {
    const env = loadEnv()
    this.connection = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
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
    opts: Pick<
      JobsOptions,
      'jobId' | 'attempts' | 'backoff' | 'removeOnFail' | 'removeOnComplete' | 'delay'
    > = {},
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
          attempts: 3,
          backoff: { type: 'exponential' },
          removeOnFail: true,
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
        removeOnFail: true,
      },
    )
  }

  enqueueEmbedding(assetId: string, fileId: string, userId: string): void {
    void this.enqueue(
      'process-embeddings',
      'process-embeddings',
      { assetId, fileId, userId },
      {
        // model is part of the id: switching models must not collide with the old model's job
        jobId: `embed-${assetId}-${SEARCH_EMBEDDING_MODEL}`,
        attempts: 3,
        backoff: { type: 'exponential' },
        removeOnFail: true,
      },
    )
  }

  enqueueOcr(assetId: string, fileId: string, userId: string): void {
    void this.enqueue(
      'process-ocr',
      'process-ocr',
      { assetId, fileId, userId },
      {
        jobId: `ocr-${assetId}`,
        attempts: 3,
        backoff: { type: 'exponential' },
        removeOnFail: true,
      },
    )
  }

  enqueueDetect(assetId: string, fileId: string, userId: string): void {
    void this.enqueue(
      'process-detect',
      'process-detect',
      { assetId, fileId, userId },
      {
        jobId: `detect-${assetId}`,
        attempts: 3,
        backoff: { type: 'exponential' },
        removeOnFail: true,
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
