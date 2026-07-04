import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { AssetsProxyController } from './assets-proxy.controller'
import { TrashProxyController } from './trash-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [TrashProxyController, AssetsProxyController],
})
export class AssetsProxyModule {}
