import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { MediaProxyController } from './media-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [MediaProxyController],
})
export class MediaProxyModule {}
