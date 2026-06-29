import { Module } from '@nestjs/common'
import { ProxyModule } from '../proxy.module'
import { PersonsProxyController } from './persons-proxy.controller'

@Module({
  imports: [ProxyModule],
  controllers: [PersonsProxyController],
})
export class PersonsProxyModule {}
