import Redis from 'ioredis'
import type { RedisConfig } from './redis.module'

export class RedisService {
  private client: Redis | null = null
  private config: RedisConfig

  constructor(config: RedisConfig) {
    this.config = config
  }

  private getClient(): Redis {
    if (!this.client) {
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy(times) {
          if (times > 3) return null
          return Math.min(times * 200, 2000)
        },
      })
      this.client.on('error', () => undefined)
    }
    return this.client
  }

  async connect(): Promise<void> {
    try {
      const client = this.getClient()
      if (client.status === 'wait' || client.status === 'reconnecting') {
        await client.connect()
      }
    } catch {
      // Connection failed — health checks will report degraded
    }
  }

  disconnect(): void {
    if (this.client) {
      this.client.disconnect()
      this.client = null
    }
  }

  async ping(): Promise<string> {
    const client = this.getClient()
    if (client.status !== 'ready') {
      await client.connect().catch(() => undefined)
    }
    if (client.status !== 'ready') {
      throw new Error('Redis not connected')
    }
    return client.ping()
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.getClient().publish(channel, message)
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    const subscriber = this.getClient().duplicate()
    await subscriber.subscribe(channel)
    subscriber.on('message', (_ch, message) => callback(message))
  }
}
