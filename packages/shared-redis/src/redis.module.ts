import { Module, Global } from '@nestjs/common'
import { RedisService } from './redis.service'

export interface RedisConfig {
  host: string
  port: number
}

@Global()
@Module({})
export class RedisModule {
  static forRoot(config: RedisConfig) {
    const redisService = new RedisService(config)
    return {
      module: RedisModule,
      providers: [
        {
          provide: RedisService,
          useValue: redisService,
        },
      ],
      exports: [RedisService],
    }
  }
}
