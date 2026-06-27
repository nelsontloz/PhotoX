import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { AdminGuard } from '../../auth/admin.guard'
import { AdminUsersProxyController } from './admin-users-proxy.controller'
import { AdminAssetsProxyController } from './admin-assets-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [AdminUsersProxyController, AdminAssetsProxyController],
  providers: [AdminGuard],
})
export class AdminProxyModule {}
