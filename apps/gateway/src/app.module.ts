import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { GatewayAuthModule } from './auth/auth.module'
import { ProxyModule } from './proxy/proxy.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    GatewayAuthModule,
    ProxyModule,
    HealthModule,
  ],
})
export class AppModule {}
