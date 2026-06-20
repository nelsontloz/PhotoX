import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { DatabaseModule } from './database/database.module'
import { AssetsModule } from './assets/assets.module'
import { RedisModule } from '@photox/shared-redis'
import { loadEnv } from '@photox/shared-config'

const env = loadEnv()

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule.forRoot('library_db'),
    RedisModule.forRoot({ host: env.REDIS_HOST, port: env.REDIS_PORT }),
    AssetsModule,
    HealthModule,
  ],
})
export class AppModule {}
