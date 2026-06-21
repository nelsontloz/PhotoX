import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { FilesProxyController } from './files-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [FilesProxyController],
})
export class FilesProxyModule {}
