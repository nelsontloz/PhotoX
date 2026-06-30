import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ProxyModule } from '../proxy.module'
import { FilesProxyController } from './files-proxy.controller'

@Module({
  imports: [HttpModule, ProxyModule],
  controllers: [FilesProxyController],
})
export class FilesProxyModule {}
