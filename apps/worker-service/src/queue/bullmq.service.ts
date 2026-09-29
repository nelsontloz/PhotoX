import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { Queue, Worker, type Job, type JobsOptions, type WorkerOptions } from 'bullmq'

@Injectable()
export class BullMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqService.name)
  private connection!: Redis
  private readonly workers: Worker[] = []
  private readonly queues = new Map<string, Queue>()

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get<string>('REDIS_HOST', 'localhost')
    const port = this.config.get<number>('REDIS_PORT', 6379)
    const password = this.config.get<string>('REDIS_PASSWORD')
    await new Promise<void>((resolve, reject) => {
      this.connection = new Redis({ host, port, password, maxRetriesPerRequest: null })
      this.connection.once('ready', () => resolve())
      this.connection.once('error', (err) => reject(err))
    })
    this.logger.log('BullMQ Redis connection established')
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()))
    await Promise.all([...this.queues.values()].map((q) => q.close()))
    await this.connection.quit()
    this.logger.log('BullMQ connection closed')
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
      await this.getQueue(queueName).add(jobName, data, opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to enqueue ${queueName} job: ${msg}`)
    }
  }

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
      this.logger.error(`Job ${job?.id} on ${name} failed: ${err.message}\n${err.stack ?? ''}`)
    })
    worker.on('error', (err) => {
      this.logger.error(`Worker ${name} error: ${err.message}`)
    })
    return worker
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.connection.ping()
      return result === 'PONG'
    } catch {
      return false
    }
  }
}
