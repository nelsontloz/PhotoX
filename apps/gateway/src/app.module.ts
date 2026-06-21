import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { ServicesModule } from './services/services.module'
import { AuthModule } from './auth/auth.module'
import { AuthProxyModule } from './proxy/auth-proxy/auth-proxy.module'
import { UsersProxyModule } from './proxy/users-proxy/users-proxy.module'
import { FilesProxyModule } from './proxy/files-proxy/files-proxy.module'
import { MediaProxyModule } from './proxy/media-proxy/media-proxy.module'
import { UploadFlowModule } from './flows/upload/upload.module'
import { AssetListFlowModule } from './flows/asset-list/asset-list.module'
import { AssetDetailFlowModule } from './flows/asset-detail/asset-detail.module'
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
    FilesProxyModule,
    MediaProxyModule,
    UploadFlowModule,
    AssetListFlowModule,
    AssetDetailFlowModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
