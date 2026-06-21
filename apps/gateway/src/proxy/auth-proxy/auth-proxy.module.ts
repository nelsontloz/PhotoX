import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { AuthProxyController } from './auth-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [AuthProxyController],
})
export class AuthProxyModule {}
