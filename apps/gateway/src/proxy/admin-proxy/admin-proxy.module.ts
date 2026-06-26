import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { AdminGuard } from '../../auth/admin.guard'
import { AdminUsersProxyController } from './admin-users-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [AdminUsersProxyController],
  providers: [AdminGuard],
})
export class AdminProxyModule {}
