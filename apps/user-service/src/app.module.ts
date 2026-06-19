import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { DatabaseModule } from './database/database.module'
import { RedisModule } from '@photox/shared-redis'
import { loadEnv } from '@photox/shared-config'

const env = loadEnv()

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule.forRoot('users_db'),
    RedisModule.forRoot({ host: env.REDIS_HOST, port: env.REDIS_PORT }),
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
