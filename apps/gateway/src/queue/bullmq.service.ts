import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import Redis from 'ioredis'

@Injectable()
export class BullMqService implements OnModuleInit, OnModuleDestroy {
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

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close()
    }
    await this.connection.quit()
  }
}
