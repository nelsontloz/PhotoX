import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { AuthProxyModule } from './proxy/auth-proxy/auth-proxy.module'
import { AssetsProxyModule } from './proxy/assets-proxy/assets-proxy.module'
import { FilesProxyModule } from './proxy/files-proxy/files-proxy.module'
import { AdminProxyModule } from './proxy/admin-proxy/admin-proxy.module'
import { PersonsProxyModule } from './proxy/persons-proxy/persons-proxy.module'
import { FacesProxyModule } from './proxy/faces-proxy/faces-proxy.module'
import { BullMqModule } from './queue/bullmq.module'
import { JwtAuthGuard } from './auth/jwt-auth.guard'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    HealthModule,
    AuthModule,
    AuthProxyModule,
    AssetsProxyModule,
    FilesProxyModule,
    AdminProxyModule,
    PersonsProxyModule,
    FacesProxyModule,
    BullMqModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
