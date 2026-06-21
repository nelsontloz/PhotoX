import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { ServicesModule } from './services/services.module'
import { AuthModule } from './auth/auth.module'
import { AuthProxyModule } from './proxy/auth-proxy/auth-proxy.module'
import { UsersProxyModule } from './proxy/users-proxy/users-proxy.module'
import { JwtAuthGuard } from './auth/jwt-auth.guard'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    HealthModule,
    ServicesModule,
    AuthModule,
    AuthProxyModule,
    UsersProxyModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
