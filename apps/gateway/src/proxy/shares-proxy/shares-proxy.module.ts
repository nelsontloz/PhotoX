import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ProxyModule } from '../proxy.module'
import { SharesProxyController } from './shares-proxy.controller'
import { PublicSharesProxyController } from './public-shares-proxy.controller'

@Module({
  imports: [HttpModule, ProxyModule],
  controllers: [SharesProxyController, PublicSharesProxyController],
})
export class SharesProxyModule {}
