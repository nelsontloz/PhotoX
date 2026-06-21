import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { UsersProxyController } from './users-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [UsersProxyController],
})
export class UsersProxyModule {}
