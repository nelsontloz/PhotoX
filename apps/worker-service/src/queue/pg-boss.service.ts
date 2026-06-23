import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PgBoss, type Job, type SendOptions, type WorkOptions, type ConstructorOptions } from 'pg-boss'

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossService.name)
  private boss!: PgBoss
  private started = false

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get<string>('POSTGRES_HOST', 'localhost')
    const port = this.config.get<number>('POSTGRES_PORT', 5432)
    const user = this.config.get<string>('POSTGRES_USER', 'photox')
    const password = this.config.get<string>('POSTGRES_PASSWORD', 'photox_dev')
    const database = 'worker_db'

    this.boss = new PgBoss({
      host,
      port,
      database,
      user,
      password,
      schema: 'pgboss',
    } satisfies ConstructorOptions)

    this.boss.on('error', (err: Error) => {
      this.logger.error(`PG Boss error: ${err.message}`)
    })

    await this.boss.start()
    this.started = true
    this.logger.log('PG Boss started')
  }

  async onModuleDestroy() {
    await this.boss.stop({ graceful: true, timeout: 5000, close: true })
    this.started = false
    this.logger.log('PG Boss stopped')
  }

  isConnected(): boolean {
    return this.started
  }

  async createQueue(name: string, options?: { policy?: string }): Promise<void> {
    await this.boss.createQueue(name, options)
    this.logger.log(`Queue created: ${name}`)
  }

  async send(queue: string, data: Record<string, unknown>, options?: SendOptions) {
    return this.boss.send(queue, data, options)
  }

  async work<T = Record<string, unknown>>(
    queue: string,
    handler: (jobs: Job<T>[]) => Promise<void>,
    options?: WorkOptions,
  ) {
    return this.boss.work<T>(queue, options ?? {}, handler as never)
  }
}
