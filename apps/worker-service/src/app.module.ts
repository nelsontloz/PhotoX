import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { DatabaseModule } from './database/database.module'
import { QueueModule } from './queue/queue.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule.forRoot('worker_db'),
    QueueModule,
    HealthModule,
  ],
})
export class AppModule {}
