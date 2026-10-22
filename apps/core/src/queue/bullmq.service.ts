import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { loadAuthEnv, loadEnv } from '@photox/shared-config'
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { Queue, Worker, type Job, type JobsOptions, type WorkerOptions } from 'bullmq'
import Redis from 'ioredis'
import { createHmac } from 'node:crypto'

// ponytail: one table for the three identical asset job wrappers; jobId prefixes are the dedup
// contract — `embed-` also pins the model so a switch never collides with the old model's job
const ASSET_JOBS = {
  embed: {
    queue: 'process-embeddings',
    jobId: (assetId: string) => `embed-${assetId}-${SEARCH_EMBEDDING_MODEL}`,
  },
  ocr: { queue: 'process-ocr', jobId: (assetId: string) => `ocr-${assetId}` },
  detect: { queue: 'process-detect', jobId: (assetId: string) => `detect-${assetId}` },
} as const

type AssetJobKind = keyof typeof ASSET_JOBS

@Injectable()
export class BullMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqService.name)
  private connection!: Redis
  private readonly queues = new Map<string, Queue>()
  private readonly workers: Worker[] = []
  private workerSecret: string | undefined

  onModuleInit(): void {
    const env = loadEnv()
    this.connection = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      maxRetriesPerRequest: null,
    })
    this.workerSecret = loadAuthEnv().WORKER_JWT_SECRET
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
  ): Promise<boolean> {
    try {
      // ponytail: retry defaults live here; callers pass only what they override
      await this.getQueue(queueName).add(jobName, this.withJobSig(data), {
        attempts: 3,
        backoff: { type: 'exponential' },
        removeOnFail: true,
        ...opts,
      })
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to enqueue ${queueName} job: ${msg}`)
      return false
    }
  }

  // ponytail: HMAC job binding — stamps proof that core enqueued this (sub, scope) pair; the
  // worker threads it back as X-Job-Signature and the guard recomputes it per route. Scope is
  // the asset/file/user id (not the BullMQ jobId, which the guard cannot see), so replay is
  // confined to the asset, not the individual job — per-job binding if that ever matters.
  // Unsigned when the secret is unavailable (unit specs that never boot the module); the guard
  // requires the secret at boot, so a serving core always stamps.
  private withJobSig(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.workerSecret) return data
    const sub = data.userId
    if (typeof sub !== 'string' || sub.length === 0) return data
    const scope = [data.assetId, data.fileId, data.userId].find(
      (v): v is string => typeof v === 'string' && v.length > 0,
    )
    if (!scope) return data
    return {
      ...data,
      sig: createHmac('sha256', this.workerSecret).update(`${sub}:${scope}`).digest('hex'),
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

  async enqueueThumbnails(
    assetId: string,
    fileId: string,
    userId: string,
    prefix = 'thumb',
  ): Promise<boolean> {
    const results = await Promise.all(
      ['sm', 'md', 'lg', 'xl'].map((size) =>
        this.enqueue(
          'process-thumbnail',
          'process-thumbnail',
          { assetId, fileId, userId, size },
          {
            jobId: `${prefix}-${assetId}-${size}`,
          },
        ),
      ),
    )
    return results.every(Boolean)
  }

  async enqueueVideo(
    assetId: string,
    fileId: string,
    userId: string,
    opts?: { reprocess?: boolean; jobId?: string },
  ): Promise<boolean> {
    return this.enqueue(
      'process-video',
      'process-video',
      { assetId, fileId, userId },
      {
        // restore passes a run-scoped jobId; the two shipped shapes stay the default
        jobId: opts?.jobId ?? `${opts?.reprocess ? 'video-reprocess' : 'video'}-${assetId}`,
        // ponytail: a video retry can cost up to 1h of SVT-AV1 — one retry absorbs
        // transient flakes; the second retry is the most expensive one, cut it
        attempts: 2,
      },
    )
  }

  async enqueueAssetJob(
    kind: AssetJobKind,
    assetId: string,
    fileId: string,
    userId: string,
  ): Promise<boolean> {
    const job = ASSET_JOBS[kind]
    return this.enqueue(
      job.queue,
      job.queue,
      { assetId, fileId, userId },
      { jobId: job.jobId(assetId) },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()))
    for (const queue of this.queues.values()) {
      await queue.close()
    }
    await this.connection.quit()
  }

  /**
   * Core-side consumer factory (mirrors worker-service's BullMqService.createWorker).
   * Only the user-delete queue consumes in core — core owns the DB + storage, and the
   * worker-service must never gain DB access. Media queues stay worker-side.
   */
  createWorker<T>(
    name: string,
    processor: (job: Job<T>) => Promise<void>,
    opts?: Partial<WorkerOptions>,
  ): Worker<T> {
    const worker = new Worker<T>(name, processor, {
      connection: this.connection,
      concurrency: 1,
      ...opts,
    })
    this.workers.push(worker)
    worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} on ${name} failed: ${err.message}`)
    })
    worker.on('error', (err) => {
      this.logger.error(`Worker ${name} error: ${err.message}`)
    })
    return worker
  }
}
