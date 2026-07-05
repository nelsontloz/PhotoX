import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ProxyModule } from '../proxy.module'
import { AdminGuard } from '../../auth/admin.guard'
import { AdminUsersProxyController } from './admin-users-proxy.controller'
import { AdminAssetsProxyController } from './admin-assets-proxy.controller'
import { AdminThumbnailsProxyController } from './admin-thumbnails-proxy.controller'
import { AdminProxyController } from './admin-proxy.controller'

@Module({
  imports: [ProxyModule, HttpModule],
  controllers: [
    AdminUsersProxyController,
    AdminAssetsProxyController,
    AdminThumbnailsProxyController,
    AdminProxyController,
  ],
  providers: [AdminGuard],
})
export class AdminProxyModule {}
