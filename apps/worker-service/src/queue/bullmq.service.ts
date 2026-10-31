import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { loadAuthEnv, loadEnv } from '@photox/shared-config';
import Redis from 'ioredis';
import { Queue, Worker, type Job, type JobsOptions, type WorkerOptions } from 'bullmq';
import { createHmac } from 'node:crypto';
import { jobScopeOf } from './job-schemas';

// Per-user media queues whose pending jobs must not retry-noise into 404s after the rows
// are gone. The sweep matches on job DATA userId, so jobId prefixes stay out of this list.
const USER_JOB_QUEUES = [
  'process-thumbnail',
  'process-video',
  'process-metadata',
  'process-faces',
  'process-faces-cluster',
  'process-embeddings',
  'process-detect',
] as const;

@Injectable()
export class BullMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqService.name);
  private connection!: Redis;
  private readonly workers: Worker[] = [];
  private readonly queues = new Map<string, Queue>();
  private workerSecret: string | undefined;
  private connecting: Promise<void> | null = null;

  async onModuleInit() {
    await this.ready();
  }

  // idempotent: ProcessorsService awaits this before creating any worker, so the connection no
  // longer depends on which provider's OnModuleInit hook Nest happens to run first
  ready(): Promise<void> {
    this.connecting ??= this.connect();
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const env = loadEnv();
    await new Promise<void>((resolve, reject) => {
      this.connection = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD,
        db: env.REDIS_DB,
        maxRetriesPerRequest: null,
      });
      this.connection.once('ready', () => resolve());
      this.connection.once('error', (err) => reject(err));
    });
    // best-effort: test harnesses boot without auth secrets (no core guard to satisfy there);
    // without it re-enqueued jobs simply carry no fresh binding
    try {
      this.workerSecret = loadAuthEnv().WORKER_JWT_SECRET;
    } catch {
      this.workerSecret = undefined;
    }
    this.logger.log('BullMQ Redis connection established');
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.connection.quit();
    this.logger.log('BullMQ connection closed');
  }

  getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection });
      this.queues.set(name, queue);
    }
    return queue;
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
      await this.getQueue(queueName).add(jobName, this.withJobSig(data), opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to enqueue ${queueName} job: ${msg}`);
      throw err instanceof Error ? err : new Error(msg);
    }
  }

  // ponytail: same binding as core's enqueue, stamp-if-absent — worker-originated jobs (cluster
  // debounce, metadata-wait re-add, legacy re-embed) never pass through core, and a carried sig
  // is already bound to the right scope, so only stamp when missing. Copies, never mutates, so
  // callers' data objects (and enqueue spies) see exactly what they passed.
  private withJobSig(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.workerSecret) return data;
    if (typeof data.sig === 'string' && data.sig.length > 0) return data;
    const sub = data.userId;
    if (typeof sub !== 'string' || sub.length === 0) return data;
    const scope = jobScopeOf(data);
    if (!scope) return data;
    return {
      ...data,
      sig: createHmac('sha256', this.workerSecret).update(`${sub}:${scope}`).digest('hex'),
    };
  }

  /**
   * Best-effort removal of the departing user's pending (waiting/delayed/prioritized) media
   * jobs, so they cannot retry-noise into 404s after core drops the rows. Active jobs cannot
   * be removed — they fail closed core-side. Every media queue is owned here, so the sweep
   * matches on job DATA userId and covers present and future jobId prefixes alike.
   */
  async drainUserJobs(userId: string): Promise<number> {
    let removed = 0;
    for (const name of USER_JOB_QUEUES) {
      try {
        const queue = this.getQueue(name);
        const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
        for (const job of jobs) {
          const data = job.data as { userId?: unknown } | null | undefined;
          if (data?.userId !== userId) continue;
          try {
            await job.remove();
            removed++;
          } catch {
            // raced with a pickup — the job fails closed on the missing rows
          }
        }
      } catch (err) {
        this.logger.warn(
          `User-delete drain failed for queue ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (removed > 0) this.logger.log(`User-delete drained ${removed} pending job(s)`);
    return removed;
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
    });
    this.workers.push(worker);
    worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} on ${name} failed: ${err.message}\n${err.stack ?? ''}`);
    });
    worker.on('error', (err) => {
      this.logger.error(`Worker ${name} error: ${err.message}`);
    });
    return worker;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.connection.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
