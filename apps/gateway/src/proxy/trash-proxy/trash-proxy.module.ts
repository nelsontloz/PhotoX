import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { TrashProxyController } from './trash-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [TrashProxyController],
})
export class TrashProxyModule {}
