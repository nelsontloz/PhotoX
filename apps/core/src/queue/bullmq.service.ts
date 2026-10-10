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

  /** Shared ioredis client (BullMQ's connection) for other Redis-backed features, e.g. rate limits. */
  get redis(): Redis {
    return this.connection
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
      'jobId' | 'attempts' | 'backoff' | 'removeOnFail' | 'removeOnComplete'
    > = {},
  ): Promise<void> {
    try {
      // ponytail: retry defaults live here; callers pass only what they override
      await this.getQueue(queueName).add(jobName, data, {
        attempts: 3,
        backoff: { type: 'exponential' },
        removeOnFail: true,
        ...opts,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to enqueue ${queueName} job: ${msg}`)
    }
  }

  /**
   * Enqueues one job per item over offset pages, stopping on an empty page or once `offset`
   * reaches `total`. Shared by the offset-loop admin reprocess services; metadata keeps its own
   * keyset loop (its `phash IS NULL` set shrinks as jobs complete, so offset would skip rows).
   * `removeOnComplete` lets a later reprocess run re-enqueue the same asset.
   */
  async enqueuePaged<T>(
    queueName: string,
    jobName: string,
    fetchPage: (offset: number) => Promise<{ items: T[]; total: number }>,
    build: (item: T) => { data: Record<string, unknown>; jobId: string },
  ): Promise<{ enqueued: number; total: number }> {
    let offset = 0
    let enqueued = 0
    let total = 0
    for (;;) {
      const page = await fetchPage(offset)
      total = page.total
      if (page.items.length === 0) break
      for (const item of page.items) {
        const { data, jobId } = build(item)
        await this.enqueue(queueName, jobName, data, { jobId, removeOnComplete: true })
        enqueued++
      }
      offset += page.items.length
      if (offset >= total) break
    }
    return { enqueued, total }
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
