import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { SharesProxyController } from './shares-proxy.controller'
import { PublicSharesProxyController } from './public-shares-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [SharesProxyController, PublicSharesProxyController],
})
export class SharesProxyModule {}
