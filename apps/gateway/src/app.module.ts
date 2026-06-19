import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { ServicesModule } from './services/services.module'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule, ServicesModule],
})
export class AppModule {}
