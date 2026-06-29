import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { AlbumsProxyController } from './albums-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [AlbumsProxyController],
})
export class AlbumsProxyModule {}
