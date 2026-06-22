import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { AssetsProxyController } from './assets-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [AssetsProxyController],
})
export class AssetsProxyModule {}
